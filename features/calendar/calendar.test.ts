import crypto from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ADMIN_PASSWORD, call, loginAs, setupTestEnv } from '@/tests/helpers'
import * as calendar from '@/app/api/calendar/route'
import * as connect from '@/app/api/calendar/connect/route'
import * as callback from '@/app/api/calendar/callback/route'
import * as events from '@/app/api/calendar/events/route'
import * as users from '@/app/api/admin/users/route'
import * as password from '@/app/api/account/password/route'
import type { CalendarEvent, CalendarStatus } from './types'

// Microsoft (Anmeldung und Graph) als Attrappe hinter fetch
const LOGIN = 'https://login.test'
const GRAPH = 'https://graph.test'

type Fake = {
  challenge: string | null
  verifierOk: boolean
  access: string
  refresh: string
  /** Erneuerung schlägt fehl (Zugriff widerrufen) */
  revoked: boolean
  /** Nächster Graph-Aufruf antwortet mit 401 */
  reject401: boolean
  refreshCalls: number
  graphCalls: string[]
}

const jwt = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`
const res = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const CALENDARS = [
  { id: 'cal-main', name: 'Kalender', hexColor: '#1c7ed6', isDefaultCalendar: true },
  { id: 'cal-uni', name: 'Stundenplan', hexColor: '', isDefaultCalendar: false },
]
const EVENTS: Record<string, unknown[]> = {
  'cal-main': [
    {
      id: 'e1',
      subject: 'Analysis I',
      start: { dateTime: '2026-10-19T08:15:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2026-10-19T09:45:00.0000000', timeZone: 'UTC' },
      isAllDay: false,
      location: { displayName: 'Hörsaal 1' },
      onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc' },
    },
    {
      id: 'e2',
      subject: 'Abgesagt',
      start: { dateTime: '2026-10-19T12:00:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2026-10-19T13:00:00.0000000', timeZone: 'UTC' },
      isCancelled: true,
    },
    {
      id: 'e3',
      subject: 'Exkursion',
      start: { dateTime: '2026-10-20T00:00:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2026-10-22T00:00:00.0000000', timeZone: 'UTC' },
      isAllDay: true,
      onlineMeeting: { joinUrl: 'javascript:alert(1)' },
    },
  ],
  'cal-uni': [
    {
      id: 'u1',
      subject: 'Übung Lineare Algebra',
      start: { dateTime: '2026-10-19T07:00:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2026-10-19T08:00:00.0000000', timeZone: 'UTC' },
    },
  ],
}

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input))
  if (url.origin === LOGIN && url.pathname === '/common/oauth2/v2.0/token') {
    const body = new URLSearchParams(String(init?.body))
    expect(body.get('client_id')).toBe('client-id')
    expect(body.get('client_secret')).toBe('client-secret')
    if (body.get('grant_type') === 'authorization_code') {
      if (body.get('code') !== 'good-code') return res(400, { error: 'invalid_grant' })
      const verifier = body.get('code_verifier') ?? ''
      fake.verifierOk = crypto.createHash('sha256').update(verifier).digest('base64url') === fake.challenge
      expect(body.get('redirect_uri')).toBe('http://localhost:3000/api/calendar/callback')
    } else {
      fake.refreshCalls++
      if (fake.revoked || body.get('refresh_token') !== fake.refresh) return res(400, { error: 'invalid_grant' })
    }
    fake.access = `access-${crypto.randomUUID()}`
    fake.refresh = `refresh-${crypto.randomUUID()}`
    return res(200, {
      access_token: fake.access,
      refresh_token: fake.refresh,
      expires_in: 3600,
      id_token: jwt({ name: 'Mia Muster', preferred_username: 'mia@uni.example' }),
    })
  }
  if (url.origin === GRAPH) {
    fake.graphCalls.push(url.pathname)
    const auth = new Headers(init?.headers).get('authorization')
    if (fake.reject401 || auth !== `Bearer ${fake.access}`) {
      fake.reject401 = false
      return res(401, { error: { code: 'InvalidAuthenticationToken' } })
    }
    expect(new Headers(init?.headers).get('prefer')).toBe('outlook.timezone="UTC"')
    if (url.pathname === '/v1.0/me/calendars') return res(200, { value: CALENDARS })
    const m = /^\/v1\.0\/me\/calendars\/([^/]+)\/calendarView$/.exec(url.pathname)
    if (m) {
      expect(url.searchParams.get('startDateTime')).toBeTruthy()
      return res(200, { value: EVENTS[decodeURIComponent(m[1])] ?? [] })
    }
    return res(404, {})
  }
  throw new Error(`Unerwarteter Abruf: ${url}`)
}

let env: Awaited<ReturnType<typeof setupTestEnv>>
let token = ''

beforeAll(async () => {
  env = await setupTestEnv()
  token = await loginAs('admin', ADMIN_PASSWORD)
  vi.stubGlobal('fetch', fakeFetch)
})
afterAll(() => {
  vi.unstubAllGlobals()
  env.cleanup()
})
// Die Attrappe behält ihre Tokens über alle Tests (wie Microsoft); nur die Schalter gelten je Test
const fake: Fake = { challenge: null, verifierOk: false, access: '', refresh: '', revoked: false, reject401: false, refreshCalls: 0, graphCalls: [] }
beforeEach(() => {
  Object.assign(fake, { revoked: false, reject401: false, refreshCalls: 0, graphCalls: [] })
})

function configure(on: boolean) {
  for (const [k, v] of Object.entries({
    MICROSOFT_CLIENT_ID: 'client-id',
    MICROSOFT_CLIENT_SECRET: 'client-secret',
    MICROSOFT_LOGIN_URL: LOGIN,
    MICROSOFT_GRAPH_URL: GRAPH,
  })) {
    if (on) process.env[k] = v
    else delete process.env[k]
  }
}

const status = async (cookie = token) => (await call(calendar.GET, '/api/calendar', { cookie })).data as CalendarStatus
const RANGE = { start: '2026-10-19T00:00:00.000Z', end: '2026-10-26T00:00:00.000Z' }

/** „Mit Microsoft verbinden“ bis zur Rückkehr; `tamper` verändert die Rückleitung */
async function connectAccount(cookie = token, tamper: (q: URLSearchParams, oauth: string) => string = (_q, o) => o) {
  const started = await call(connect.POST, '/api/calendar/connect', { cookie })
  expect(started.status).toBe(200)
  const authorize = new URL(started.data.url)
  fake.challenge = authorize.searchParams.get('code_challenge')
  const oauth = /noted_calendar_oauth=([^;]*)/.exec(started.res.headers.get('set-cookie') ?? '')?.[1] ?? ''
  const q = new URLSearchParams({ code: 'good-code', state: authorize.searchParams.get('state') ?? '' })
  const sentCookie = tamper(q, oauth)
  const back = await call(callback.GET, `/api/calendar/callback?${q}`, {
    headers: { cookie: `noted_session=${cookie}; noted_calendar_oauth=${sentCookie}` },
  })
  expect(back.status).toBe(303)
  return { authorize, location: back.res.headers.get('location') ?? '', setCookie: back.res.headers.get('set-cookie') ?? '' }
}

describe('Kalender (Microsoft)', () => {
  it('ohne Einrichtung durch den Admin gibt es keinen Kalender', async () => {
    configure(false)
    expect(await status()).toEqual({ configured: false, connected: false })
    expect((await call(connect.POST, '/api/calendar/connect', { cookie: token })).status).toBe(404)
  })

  it('Verbinden: Weiterleitung mit PKCE und state, an das Konto gebundene Rückkehr', async () => {
    configure(true)
    expect(await status()).toEqual({ configured: true, connected: false })

    // Falscher state oder ein Cookie aus einem anderen Browser: nichts wird gespeichert
    expect((await connectAccount(token, (q, o) => (q.set('state', 'falsch'), o))).location).toMatch(/kalender=fehler/)
    expect((await connectAccount(token, () => 'kaputt')).location).toMatch(/kalender=fehler/)
    expect((await connectAccount(token, (q, o) => (q.set('code', 'falscher-code'), o))).location).toMatch(/kalender=fehler/)
    expect((await status()).connected).toBe(false)

    // Abgebrochen bei Microsoft
    const cancelled = await call(callback.GET, '/api/calendar/callback?error=access_denied&state=x', { cookie: token })
    expect(cancelled.res.headers.get('location')).toMatch(/kalender=abgebrochen/)

    const { authorize, location, setCookie } = await connectAccount()
    expect(authorize.origin + authorize.pathname).toBe(`${LOGIN}/common/oauth2/v2.0/authorize`)
    expect(authorize.searchParams.get('client_id')).toBe('client-id')
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorize.searchParams.get('scope')).toContain(`${GRAPH}/Calendars.Read`)
    expect(authorize.searchParams.get('scope')).not.toMatch(/ReadWrite/)
    expect(fake.verifierOk).toBe(true)
    expect(location).toBe('http://localhost:3000/settings?kalender=verbunden#kalender')
    // Das Cookie mit state und PKCE-Code wird danach gelöscht
    expect(setCookie).toMatch(/noted_calendar_oauth=;.*Max-Age=0/i)

    const s = await status()
    expect(s).toMatchObject({ connected: true, account: { name: 'Mia Muster', email: 'mia@uni.example' }, error: null })
    if (!s.connected) throw new Error('nicht verbunden')
    expect(s.calendars.map((c) => [c.name, c.selected, c.color])).toEqual([
      ['Kalender', true, '#1c7ed6'],
      ['Stundenplan', false, null],
    ])
  })

  it('speichert die Zugangsdaten nur verschlüsselt', async () => {
    const { getDb } = await import('@/shared/server/db')
    const row = getDb().prepare('SELECT * FROM calendar_accounts').get() as Record<string, string>
    expect(row.refresh_token).not.toContain(fake.refresh || 'refresh-')
    expect(row.refresh_token).toMatch(/^v1\./)
    expect(row.access_token).toMatch(/^v1\./)
  })

  it('Termine des Standardkalenders: UTC, ganztägig als Datum, ohne abgesagte und unsichere Links', async () => {
    const r = await call(events.GET, '/api/calendar/events', { cookie: token, query: RANGE })
    expect(r.status).toBe(200)
    expect(r.data.events as CalendarEvent[]).toEqual([
      {
        id: 'e1',
        calendarId: 'cal-main',
        subject: 'Analysis I',
        start: '2026-10-19T08:15:00.000Z',
        end: '2026-10-19T09:45:00.000Z',
        allDay: false,
        location: 'Hörsaal 1',
        joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc',
        color: '#1c7ed6',
      },
      {
        id: 'e3',
        calendarId: 'cal-main',
        subject: 'Exkursion',
        start: '2026-10-20',
        end: '2026-10-22',
        allDay: true,
        location: null,
        joinUrl: null,
        color: '#1c7ed6',
      },
    ])
    for (const bad of [{ start: 'gestern', end: RANGE.end }, { start: RANGE.end, end: RANGE.start }, { start: '2026-01-01T00:00:00Z', end: '2026-12-31T00:00:00Z' }]) {
      expect((await call(events.GET, '/api/calendar/events', { cookie: token, query: bad })).status).toBe(400)
    }
  })

  it('weitere Kalender auswählen', async () => {
    const r = await call(calendar.PUT, '/api/calendar', { method: 'PUT', cookie: token, body: { calendars: ['cal-main', 'cal-uni'] } })
    expect(r.status).toBe(200)
    const list = (await call(events.GET, '/api/calendar/events', { cookie: token, query: RANGE })).data.events as CalendarEvent[]
    expect(list.map((e) => e.subject)).toEqual(['Übung Lineare Algebra', 'Analysis I', 'Exkursion'])
  })

  it('erneuert abgelaufene Zugriffe und lehnt Microsoft ein Token ab, wird es einmal neu geholt', async () => {
    const { getDb } = await import('@/shared/server/db')
    // Zugriffstoken abgelaufen
    getDb().prepare('UPDATE calendar_accounts SET access_expires_at = 0').run()
    const r = await call(events.GET, '/api/calendar/events', { cookie: token, query: { ...RANGE, end: '2026-10-25T00:00:00.000Z' } })
    expect(r.status).toBe(200)
    expect(fake.refreshCalls).toBe(1)
    // Neues Refresh-Token wurde gespeichert: eine zweite Erneuerung klappt damit
    fake.reject401 = true
    const again = await call(events.GET, '/api/calendar/events', { cookie: token, query: { ...RANGE, end: '2026-10-24T00:00:00.000Z' } })
    expect(again.status).toBe(200)
    expect(fake.refreshCalls).toBe(2)
  })

  it('andere Benutzer sehen den Kalender nicht', async () => {
    expect((await call(users.POST, '/api/admin/users', { cookie: token, body: { username: 'ben', password: 'Ben-Passwort-1234' } })).status).toBe(201)
    const ben = await loginAs('ben', 'Ben-Passwort-1234')
    await call(password.POST, '/', { cookie: ben, body: { currentPassword: 'Ben-Passwort-1234', newPassword: 'Ben-Passwort-5678' } })
    expect(await status(ben)).toEqual({ configured: true, connected: false })
    expect((await call(events.GET, '/api/calendar/events', { cookie: ben, query: RANGE })).data.events).toEqual([])
    expect((await call(calendar.PUT, '/api/calendar', { method: 'PUT', cookie: ben, body: { calendars: [] } })).status).toBe(409)
    // Die Rückkehr mit dem Cookie eines anderen Kontos zählt nicht
    const started = await call(connect.POST, '/api/calendar/connect', { cookie: token })
    const oauth = /noted_calendar_oauth=([^;]*)/.exec(started.res.headers.get('set-cookie') ?? '')?.[1]
    const state = new URL(started.data.url).searchParams.get('state')
    const back = await call(callback.GET, `/api/calendar/callback?code=good-code&state=${state}`, {
      headers: { cookie: `noted_session=${ben}; noted_calendar_oauth=${oauth}` },
    })
    expect(back.res.headers.get('location')).toMatch(/kalender=fehler/)
    expect((await status(ben)).connected).toBe(false)
  })

  it('widerrufener Zugriff: Hinweis zum neu Verbinden', async () => {
    const { getDb } = await import('@/shared/server/db')
    getDb().prepare('UPDATE calendar_accounts SET access_expires_at = 0').run()
    fake.revoked = true
    const r = await call(events.GET, '/api/calendar/events', { cookie: token, query: { ...RANGE, end: '2026-10-23T00:00:00.000Z' } })
    expect(r.status).toBe(409)
    expect(r.data.error).toBe('calendar_reconnect')
    const s = await status()
    expect(s).toMatchObject({ connected: true, error: expect.stringMatching(/neu/) })
    // Neu verbinden behebt es und behält die Auswahl (gleiches Konto)
    fake.revoked = false
    await connectAccount()
    const fixed = await status()
    if (!fixed.connected) throw new Error('nicht verbunden')
    expect(fixed.error).toBeNull()
    expect(fixed.calendars.filter((c) => c.selected).map((c) => c.id)).toEqual(['cal-main', 'cal-uni'])
  })

  it('Trennen löscht die Zugangsdaten und steht im Sicherheitsprotokoll', async () => {
    expect((await call(calendar.DELETE, '/api/calendar', { method: 'DELETE', cookie: token })).status).toBe(200)
    expect(await status()).toEqual({ configured: true, connected: false })
    const { getDb } = await import('@/shared/server/db')
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM calendar_accounts').get()).toEqual({ n: 0 })
    const logged = getDb().prepare("SELECT event FROM audit_log WHERE event LIKE 'calendar_%'").all() as { event: string }[]
    expect(logged.map((e) => e.event)).toEqual(['calendar_connected', 'calendar_connected', 'calendar_disconnected'])
  })
})
