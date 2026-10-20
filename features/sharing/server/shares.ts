import 'server-only'
import { cache } from 'react'
import { headers } from 'next/headers'
import type { NextRequest } from 'next/server'
import { getDb } from '@/shared/server/db'
import { getConfig } from '@/shared/server/config'
import { ApiError, badRequest, clientIpFromHeaders, notFound } from '@/shared/server/http'
import { randomToken, sha256 } from '@/shared/server/crypto'
import { ipKey, rateLimit } from '@/shared/server/rate-limit'
import { audit } from '@/shared/server/audit'
import { fileReferences } from '@/features/attachments/references'
import { attachmentResponse, getAttachmentByName } from '@/features/attachments/server/attachments'
import type { NoteFormat } from '@/features/notes/types'
import { SHARE_RATE_LIMIT, SHARE_RATE_WINDOW_MS } from '../limits'
import type { Share, SharedNote, ShareExpiry } from '../types'

const DAY = 86_400_000
/** randomToken(32) ergibt 43 Zeichen base64url – alles andere kann kein Link sein */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/
const SHARE_ID_RE = /^[0-9a-f]{64}$/

type ShareRow = {
  id: string
  note_id: string
  created_at: number
  expires_at: number | null
  last_opened_at: number | null
  opens: number
  title: string
  deleted_at: number | null
}

const toShare = (r: ShareRow): Share => ({
  id: r.id,
  noteId: r.note_id,
  noteTitle: r.title,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  lastOpenedAt: r.last_opened_at,
  opens: r.opens,
  noteTrashed: r.deleted_at !== null,
})

/** Mit SHARING=false gibt es keine Freigaben – für niemanden, auch nicht für die Verwaltung */
function assertSharingEnabled() {
  if (!getConfig().sharing) throw notFound()
}

/** Adresse der App für Links: APP_URL, sonst so, wie der Browser die App aufgerufen hat (auch hinter einem Proxy) */
export function publicOrigin(req: NextRequest): string {
  const { appUrl } = getConfig()
  if (appUrl) return appUrl
  const host = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || req.headers.get('host') || req.nextUrl.host
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || req.nextUrl.protocol.replace(/:$/, '')
  return `${proto}://${host}`
}

type Actor = { user: { id: number; username: string }; ip: string | null }

/** Link auf eine Notiz anlegen. Das Token steht nur in der Antwort – gespeichert wird sein Hash. */
export function createShare(
  { user, ip }: Actor,
  noteId: string,
  expiresInDays: ShareExpiry,
  origin: string,
  now = Date.now(),
): { share: Share; url: string } {
  assertSharingEnabled()
  const note = getDb()
    .prepare('SELECT format FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .get(noteId, user.id) as { format: NoteFormat } | undefined
  if (!note) throw notFound('Notiz nicht gefunden.')
  if (note.format === 'canvas') throw badRequest('Ein Canvas lässt sich nicht teilen.')
  const token = randomToken(32)
  const id = sha256(token)
  const expiresAt = expiresInDays === null ? null : now + expiresInDays * DAY
  getDb()
    .prepare('INSERT INTO shares (id, user_id, note_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, user.id, noteId, now, expiresAt)
  audit({ event: 'share_created', userId: user.id, username: user.username, ip, details: { noteId, expiresAt } })
  return { share: listShares(user.id, { noteId, now }).find((s) => s.id === id)!, url: `${origin}/s/${token}` }
}

/** Gültige Freigaben eines Nutzers (neueste zuerst), optional nur einer Notiz */
export function listShares(userId: number, opts: { noteId?: string; now?: number } = {}): Share[] {
  assertSharingEnabled()
  const db = getDb()
  if (opts.noteId && !db.prepare('SELECT 1 FROM notes WHERE id = ? AND user_id = ?').get(opts.noteId, userId)) {
    throw notFound('Notiz nicht gefunden.')
  }
  const rows = db
    .prepare(
      `SELECT s.id, s.note_id, s.created_at, s.expires_at, s.last_opened_at, s.opens, n.title, n.deleted_at
       FROM shares s JOIN notes n ON n.id = s.note_id
       WHERE s.user_id = ? AND n.user_id = ? ${opts.noteId ? 'AND s.note_id = ?' : ''}
         AND (s.expires_at IS NULL OR s.expires_at > ?)
       ORDER BY s.created_at DESC`,
    )
    .all(...[userId, userId, ...(opts.noteId ? [opts.noteId] : []), opts.now ?? Date.now()]) as ShareRow[]
  return rows.map(toShare)
}

/** Link widerrufen – er führt danach ins Leere (404) */
export function revokeShare({ user, ip }: Actor, id: string) {
  assertSharingEnabled()
  const deleted = SHARE_ID_RE.test(id)
    ? getDb().prepare('DELETE FROM shares WHERE id = ? AND user_id = ?').run(id, user.id).changes
    : 0
  if (!deleted) throw notFound('Link nicht gefunden.')
  audit({ event: 'share_revoked', userId: user.id, username: user.username, ip })
}

/**
 * Zugriff eines Gasts über das Token: erst das Rate-Limit je IP, dann Freigabe und Notiz. Falsche, abgelaufene und
 * widerrufene Links, Notizen im Papierkorb und Canvas ergeben dasselbe 404 – ohne Hinweis, ob es den Link je gab.
 */
function openShare(token: string, ip: string | null, now: number) {
  assertSharingEnabled()
  if (!rateLimit(`share:${ipKey(ip)}`, SHARE_RATE_LIMIT, SHARE_RATE_WINDOW_MS).ok) {
    throw new ApiError(429, 'rate_limited', 'Zu viele Aufrufe. Bitte warte einen Moment.')
  }
  if (!TOKEN_RE.test(token)) throw notFound()
  const db = getDb()
  const share = db
    .prepare('SELECT id, user_id AS userId, note_id AS noteId FROM shares WHERE id = ? AND (expires_at IS NULL OR expires_at > ?)')
    .get(sha256(token), now) as { id: string; userId: number; noteId: string } | undefined
  if (!share) throw notFound()
  const note = db
    .prepare('SELECT title, format, content, updated_at AS updatedAt FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .get(share.noteId, share.userId) as SharedNote | undefined
  if (!note || note.format === 'canvas') throw notFound()
  return { share, note }
}

/** Geteilte Notiz für Gäste – zählt den Aufruf */
export function getSharedNote(token: string, ip: string | null, now = Date.now()): SharedNote {
  const { share, note } = openShare(token, ip, now)
  getDb().prepare('UPDATE shares SET opens = opens + 1, last_opened_at = ? WHERE id = ?').run(now, share.id)
  return note
}

/**
 * Für die Seite /s/[token]: einmal je Anfrage laden (Titel und Seite teilen sich den Aufruf) – null, wenn es den Link
 * nicht (mehr) gibt, 'limited' bei zu vielen Aufrufen.
 */
export const loadSharedPage = cache(async (token: string): Promise<SharedNote | 'limited' | null> => {
  try {
    return getSharedNote(token, clientIpFromHeaders(await headers()))
  } catch (err) {
    if (err instanceof ApiError && err.status === 429) return 'limited'
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
})

/** Datei einer geteilten Notiz – nur, was die Notiz selbst einbettet oder verlinkt */
export function sharedFileResponse(token: string, name: string, ip: string | null, range: string | null): Response {
  const { share, note } = openShare(token, ip, Date.now())
  const base = (name.split('/').pop() ?? '').trim()
  if (!base || !fileReferences(note.format, note.content).has(base.toLowerCase())) throw notFound()
  const res = attachmentResponse(share.userId, getAttachmentByName(share.userId, base), range)
  // Nach einem Widerruf soll nichts mehr aus dem Browser-Cache kommen
  res.headers.set('Cache-Control', 'private, no-store')
  return res
}

/** Abgelaufene Links löschen (regelmäßiges Aufräumen) */
export function purgeExpiredShares(now = Date.now()) {
  getDb().prepare('DELETE FROM shares WHERE expires_at IS NOT NULL AND expires_at <= ?').run(now)
}
