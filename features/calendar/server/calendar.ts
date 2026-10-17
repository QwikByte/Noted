import 'server-only'
// Verbundener Kalender je Benutzer: Verbinden, Kalenderauswahl, Termine. Jede Abfrage gilt nur dem eigenen Konto.
import crypto from 'node:crypto'
import type { NextRequest } from 'next/server'
import { getDb } from '@/shared/server/db'
import { getConfig } from '@/shared/server/config'
import { decrypt, encrypt, randomToken } from '@/shared/server/crypto'
import { ApiError, badRequest } from '@/shared/server/http'
import { audit } from '@/shared/server/audit'
import { MAX_RANGE_DAYS, type CalendarEvent, type CalendarStatus } from '../types'
import {
  MicrosoftAuthError,
  accountFromIdToken,
  authorizeUrl,
  exchangeCode,
  graphGet,
  microsoftConfig,
  pkcePair,
  refreshTokens,
  type MicrosoftConfig,
} from './microsoft'

type AccountRow = {
  user_id: number
  name: string
  email: string
  refresh_token: string
  access_token: string | null
  access_expires_at: number | null
  calendars: string | null
  error: string | null
}

type GraphCalendar = { id: string; name: string; hexColor?: string; isDefaultCalendar?: boolean }
type GraphDateTime = { dateTime: string; timeZone: string }
type GraphEvent = {
  id: string
  subject?: string
  start: GraphDateTime
  end: GraphDateTime
  isAllDay?: boolean
  isCancelled?: boolean
  location?: { displayName?: string } | null
  onlineMeeting?: { joinUrl?: string } | null
}

const DAY = 86_400_000
const RECONNECT = 'Die Verbindung zu Microsoft ist abgelaufen. Bitte verbinde den Kalender neu.'
// Kurz zwischenspeichern: Das Dashboard fragt bei jedem Fokuswechsel neu, Microsoft drosselt viele Anfragen
const CALENDARS_TTL_MS = 5 * 60_000
const EVENTS_TTL_MS = 60_000

const reconnectError = (message = RECONNECT) => new ApiError(409, 'calendar_reconnect', message)

function requireConfig(): MicrosoftConfig {
  const cfg = microsoftConfig()
  if (!cfg) throw new ApiError(404, 'calendar_not_configured', 'Die Kalender-Anbindung ist auf diesem Server nicht eingerichtet.')
  return cfg
}

function getAccount(userId: number): AccountRow | undefined {
  return getDb().prepare('SELECT * FROM calendar_accounts WHERE user_id = ?').get(userId) as AccountRow | undefined
}

function setError(userId: number, error: string) {
  getDb().prepare('UPDATE calendar_accounts SET error = ?, access_token = NULL, updated_at = ? WHERE user_id = ?').run(error, Date.now(), userId)
}

function tryDecrypt(value: string | null): string | null {
  try {
    return value ? decrypt(value) : null
  } catch {
    // z. B. nach einem neuen SECRET_KEY – dann hilft nur neu verbinden
    return null
  }
}

const calendarCache = new Map<number, { at: number; list: GraphCalendar[] }>()
const eventCache = new Map<string, { at: number; events: CalendarEvent[] }>()

function forget(userId: number) {
  calendarCache.delete(userId)
  for (const key of eventCache.keys()) if (key.startsWith(`${userId}:`)) eventCache.delete(key)
}

/** Rückkehradresse nach der Anmeldung – muss genau so in der App-Registrierung bei Microsoft stehen */
export function redirectUri(req: NextRequest): string {
  const { appUrl } = getConfig()
  if (appUrl) return `${appUrl}/api/calendar/callback`
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || req.nextUrl.protocol.replace(':', '')
  const host = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || req.headers.get('host') || req.nextUrl.host
  return `${proto}://${host}/api/calendar/callback`
}

// --- Verbinden -------------------------------------------------------------------------------------------------------

/** Cookie, das state und PKCE-Code bis zur Rückkehr von Microsoft aufbewahrt (verschlüsselt, an das Konto gebunden) */
export const OAUTH_COOKIE = 'noted_calendar_oauth'
export const OAUTH_TTL_MS = 10 * 60_000
type OAuthState = { s: string; v: string; u: number; e: number }

/** Beginnt die Anmeldung bei Microsoft: Adresse für die Weiterleitung und Inhalt des Cookies */
export function startConnect(userId: number, redirect: string): { url: string; cookie: string } {
  const cfg = requireConfig()
  const state = randomToken(24)
  const { verifier, challenge } = pkcePair()
  const saved: OAuthState = { s: state, v: verifier, u: userId, e: Date.now() + OAUTH_TTL_MS }
  return { url: authorizeUrl(cfg, { redirectUri: redirect, state, challenge }), cookie: encrypt(JSON.stringify(saved)) }
}

function sameText(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

/**
 * Rückkehr von Microsoft: state prüfen (gehört die Anmeldung zu diesem Konto und diesem Browser?), Code einlösen,
 * Zugang speichern. Ergebnis für die Einstellungsseite.
 */
export async function finishConnect(
  user: { id: number; username: string },
  opts: { code: string | null; state: string | null; error: string | null; cookie: string | undefined; redirect: string; ip: string | null },
): Promise<'verbunden' | 'abgebrochen' | 'fehler'> {
  const cfg = requireConfig()
  if (opts.error) return opts.error === 'access_denied' ? 'abgebrochen' : 'fehler'
  let saved: OAuthState | null = null
  try {
    saved = JSON.parse(tryDecrypt(opts.cookie ?? null) ?? 'null') as OAuthState | null
  } catch {
    saved = null
  }
  if (!saved || saved.u !== user.id || saved.e < Date.now() || !opts.state || !opts.code || !sameText(saved.s, opts.state)) {
    return 'fehler'
  }
  let tokens
  try {
    tokens = await exchangeCode(cfg, { code: opts.code, redirectUri: opts.redirect, verifier: saved.v })
  } catch (err) {
    if (err instanceof MicrosoftAuthError || err instanceof ApiError) {
      console.error('[noted] Kalender verbinden fehlgeschlagen', err.message)
      return 'fehler'
    }
    throw err
  }
  const account = accountFromIdToken(tokens.idToken)
  const t = Date.now()
  // Erneut verbunden: Die Kalenderauswahl bleibt, solange es dasselbe Microsoft-Konto ist
  getDb()
    .prepare(
      `INSERT INTO calendar_accounts
         (user_id, provider, name, email, refresh_token, access_token, access_expires_at, calendars, error, created_at, updated_at)
       VALUES (?, 'microsoft', ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         calendars = CASE WHEN calendar_accounts.email = excluded.email THEN calendar_accounts.calendars ELSE NULL END,
         name = excluded.name, email = excluded.email, refresh_token = excluded.refresh_token,
         access_token = excluded.access_token, access_expires_at = excluded.access_expires_at, error = NULL,
         updated_at = excluded.updated_at`,
    )
    .run(user.id, account.name, account.email, encrypt(tokens.refreshToken), encrypt(tokens.accessToken), tokens.expiresAt, t, t)
  forget(user.id)
  audit({ event: 'calendar_connected', userId: user.id, username: user.username, ip: opts.ip, details: { email: account.email } })
  return 'verbunden'
}

/** Trennt die Verbindung und löscht die gespeicherten Zugangsdaten */
export function disconnect(user: { id: number; username: string }, ip: string | null) {
  const res = getDb().prepare('DELETE FROM calendar_accounts WHERE user_id = ?').run(user.id)
  forget(user.id)
  if (res.changes) audit({ event: 'calendar_disconnected', userId: user.id, username: user.username, ip })
}

// --- Zugriff auf Microsoft Graph -------------------------------------------------------------------------------------

const refreshing = new Map<number, Promise<string>>()

/** Gültiges Zugriffstoken; abgelaufen (oder `force`) wird es erneuert – gleichzeitige Anfragen teilen sich das */
async function accessToken(cfg: MicrosoftConfig, userId: number, force = false): Promise<string> {
  const row = getAccount(userId)
  if (!row) throw new ApiError(409, 'calendar_not_connected', 'Es ist kein Kalender verbunden.')
  const current = tryDecrypt(row.access_token)
  if (!force && current && (row.access_expires_at ?? 0) > Date.now() + 60_000) return current
  const running = refreshing.get(userId)
  if (running) return running
  const task = (async () => {
    const refresh = tryDecrypt(row.refresh_token)
    if (!refresh) {
      setError(userId, RECONNECT)
      throw reconnectError()
    }
    try {
      const tokens = await refreshTokens(cfg, refresh)
      getDb()
        .prepare(
          'UPDATE calendar_accounts SET refresh_token = ?, access_token = ?, access_expires_at = ?, error = NULL, updated_at = ? WHERE user_id = ?',
        )
        .run(encrypt(tokens.refreshToken), encrypt(tokens.accessToken), tokens.expiresAt, Date.now(), userId)
      return tokens.accessToken
    } catch (err) {
      if (err instanceof MicrosoftAuthError) {
        setError(userId, RECONNECT)
        throw reconnectError()
      }
      throw err
    } finally {
      refreshing.delete(userId)
    }
  })()
  refreshing.set(userId, task)
  return task
}

/** Graph-Aufruf mit gültigem Token; lehnt Microsoft das Token ab, wird es einmal erneuert */
async function graph<T>(cfg: MicrosoftConfig, userId: number, path: string): Promise<T> {
  try {
    return await graphGet<T>(cfg, await accessToken(cfg, userId), path)
  } catch (err) {
    if (!(err instanceof MicrosoftAuthError)) throw err
  }
  try {
    return await graphGet<T>(cfg, await accessToken(cfg, userId, true), path)
  } catch (err) {
    if (!(err instanceof MicrosoftAuthError)) throw err
    setError(userId, RECONNECT)
    throw reconnectError()
  }
}

async function graphCalendars(cfg: MicrosoftConfig, userId: number): Promise<GraphCalendar[]> {
  const hit = calendarCache.get(userId)
  if (hit && Date.now() - hit.at < CALENDARS_TTL_MS) return hit.list
  const res = await graph<{ value: GraphCalendar[] }>(cfg, userId, '/me/calendars?$select=id,name,hexColor,isDefaultCalendar&$top=100')
  const list = res.value ?? []
  calendarCache.set(userId, { at: Date.now(), list })
  return list
}

/** Gewählte Kalender – ohne eigene Wahl der Standardkalender */
function selectedIds(row: AccountRow, list: GraphCalendar[]): string[] {
  let chosen: unknown = null
  try {
    chosen = row.calendars ? JSON.parse(row.calendars) : null
  } catch {
    chosen = null
  }
  if (Array.isArray(chosen)) return list.filter((c) => chosen.includes(c.id)).map((c) => c.id)
  const fallback = list.find((c) => c.isDefaultCalendar) ?? list[0]
  return fallback ? [fallback.id] : []
}

const color = (hex: string | undefined) => (hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex : null)

// --- Für die API -----------------------------------------------------------------------------------------------------

export async function calendarStatus(userId: number): Promise<CalendarStatus> {
  const cfg = microsoftConfig()
  if (!cfg) return { configured: false, connected: false }
  const row = getAccount(userId)
  if (!row) return { configured: true, connected: false }
  const base = { configured: true, connected: true, account: { name: row.name, email: row.email } } as const
  if (row.error) return { ...base, calendars: [], error: row.error }
  try {
    const list = await graphCalendars(cfg, userId)
    const selected = new Set(selectedIds(row, list))
    return {
      ...base,
      calendars: list.map((c) => ({
        id: c.id,
        name: c.name,
        color: color(c.hexColor),
        isDefault: !!c.isDefaultCalendar,
        selected: selected.has(c.id),
      })),
      error: null,
    }
  } catch (err) {
    if (err instanceof ApiError) return { ...base, calendars: [], error: err.message }
    throw err
  }
}

/** Welche Kalender im Dashboard erscheinen */
export function setCalendars(userId: number, ids: string[]) {
  requireConfig()
  const res = getDb()
    .prepare('UPDATE calendar_accounts SET calendars = ?, updated_at = ? WHERE user_id = ?')
    .run(JSON.stringify(ids), Date.now(), userId)
  if (!res.changes) throw new ApiError(409, 'calendar_not_connected', 'Es ist kein Kalender verbunden.')
  forget(userId)
}

function toIso(dt: GraphDateTime): string {
  // Graph liefert dank „Prefer: outlook.timezone="UTC"“ UTC-Zeiten ohne Zonenangabe, z. B. 2026-10-17T08:15:00.0000000
  const d = new Date(`${dt.dateTime.replace(/\.\d+$/, '')}Z`)
  return Number.isNaN(d.getTime()) ? dt.dateTime : d.toISOString()
}

function toEvent(ev: GraphEvent, calendar: GraphCalendar): CalendarEvent {
  const allDay = !!ev.isAllDay
  const joinUrl = ev.onlineMeeting?.joinUrl
  return {
    id: ev.id,
    calendarId: calendar.id,
    subject: (ev.subject ?? '').trim() || '(Ohne Titel)',
    // Ganztägig: das Datum zählt, nicht die Uhrzeit (sonst rutscht der Termin je nach Zeitzone auf den Vortag)
    start: allDay ? ev.start.dateTime.slice(0, 10) : toIso(ev.start),
    end: allDay ? ev.end.dateTime.slice(0, 10) : toIso(ev.end),
    allDay,
    location: ev.location?.displayName?.trim() || null,
    joinUrl: joinUrl && /^https:\/\//i.test(joinUrl) ? joinUrl : null,
    color: color(calendar.hexColor),
  }
}

/** Termine der gewählten Kalender im Zeitraum (Wiederholungen löst Microsoft auf), sortiert nach Beginn */
export async function listEvents(userId: number, startIso: string, endIso: string): Promise<CalendarEvent[]> {
  const cfg = requireConfig()
  const start = Date.parse(startIso)
  const end = Date.parse(endIso)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > MAX_RANGE_DAYS * DAY) {
    throw badRequest('Ungültiger Zeitraum.')
  }
  const row = getAccount(userId)
  if (!row) return []
  if (row.error) throw reconnectError(row.error)

  const key = `${userId}:${start}:${end}`
  const hit = eventCache.get(key)
  if (hit && Date.now() - hit.at < EVENTS_TTL_MS) return hit.events

  const list = await graphCalendars(cfg, userId)
  const ids = selectedIds(row, list)
  const range = `startDateTime=${new Date(start).toISOString()}&endDateTime=${new Date(end).toISOString()}`
  const query = `${range}&$select=id,subject,start,end,isAllDay,isCancelled,location,onlineMeeting&$orderby=start/dateTime&$top=100`
  const perCalendar = await Promise.all(
    ids.map(async (id) => {
      const calendar = list.find((c) => c.id === id)!
      const events: CalendarEvent[] = []
      let path: string | undefined = `/me/calendars/${encodeURIComponent(id)}/calendarView?${query}`
      // Höchstens 10 Seiten à 100 Termine – mehr passt ohnehin nicht sinnvoll auf ein Dashboard
      for (let page = 0; path && page < 10; page++) {
        const res: { value: GraphEvent[]; '@odata.nextLink'?: string } = await graph(cfg, userId, path)
        for (const ev of res.value ?? []) if (!ev.isCancelled) events.push(toEvent(ev, calendar))
        path = res['@odata.nextLink']
      }
      return events
    }),
  )
  const events = perCalendar.flat().sort((a, b) => a.start.localeCompare(b.start))

  for (const [k, v] of eventCache) if (Date.now() - v.at >= EVENTS_TTL_MS) eventCache.delete(k)
  eventCache.set(key, { at: Date.now(), events })
  return events
}
