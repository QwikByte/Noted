import 'server-only'
import { getDb } from './db'
import { getConfig } from './config'
import { randomToken, sha256 } from './crypto'
import { getUserById, type UserRow } from './users'
import type { SessionInfo } from '@/lib/shared/types'

export const SESSION_COOKIE = 'noted_session'
/** Zeit für die Eingabe des MFA-Codes nach erfolgreichem Passwort */
const MFA_STAGE_TTL_MS = 10 * 60 * 1000
export const MAX_MFA_ATTEMPTS = 5

export type SessionStage = 'mfa' | 'full'

export type SessionRow = {
  id: string
  user_id: number
  stage: SessionStage
  mfa_attempts: number
  created_at: number
  last_seen_at: number
  expires_at: number
  ip: string | null
  user_agent: string | null
}

export function sessionTtlMs(stage: SessionStage): number {
  return stage === 'mfa' ? MFA_STAGE_TTL_MS : getConfig().sessionDays * 86_400_000
}

export function createSession(
  userId: number,
  stage: SessionStage,
  meta: { ip?: string | null; userAgent?: string | null },
): { token: string; session: SessionRow } {
  const token = randomToken(32)
  const t = Date.now()
  const session: SessionRow = {
    id: sha256(token),
    user_id: userId,
    stage,
    mfa_attempts: 0,
    created_at: t,
    last_seen_at: t,
    expires_at: t + sessionTtlMs(stage),
    ip: meta.ip ?? null,
    user_agent: meta.userAgent?.slice(0, 300) ?? null,
  }
  getDb()
    .prepare(
      `INSERT INTO sessions (id, user_id, stage, mfa_attempts, created_at, last_seen_at, expires_at, ip, user_agent)
       VALUES (@id, @user_id, @stage, @mfa_attempts, @created_at, @last_seen_at, @expires_at, @ip, @user_agent)`,
    )
    .run(session)
  return { token, session }
}

/**
 * Sucht die Sitzung zu einem Token. Abgelaufene Sitzungen und deaktivierte Benutzer
 * werden verworfen. Volle Sitzungen werden gleitend verlängert.
 */
export function getSession(token: string | undefined | null): { session: SessionRow; user: UserRow } | null {
  if (!token || token.length > 200) return null
  const db = getDb()
  const id = sha256(token)
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined
  if (!session) return null
  const t = Date.now()
  if (session.expires_at <= t) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
    return null
  }
  const user = getUserById(session.user_id)
  if (!user || !user.is_active) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
    return null
  }
  // Höchstens einmal pro Minute schreiben
  if (session.stage === 'full' && t - session.last_seen_at > 60_000) {
    session.last_seen_at = t
    session.expires_at = t + sessionTtlMs('full')
    db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?').run(t, session.expires_at, id)
  }
  return { session, user }
}

export function deleteSession(id: string) {
  getDb().prepare('DELETE FROM sessions WHERE id = ?').run(id)
}

export function deleteUserSessions(userId: number, exceptId?: string) {
  getDb()
    .prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
    .run(userId, exceptId ?? '')
}

export function deleteMfaStageSessions(userId: number) {
  getDb().prepare(`DELETE FROM sessions WHERE user_id = ? AND stage = 'mfa'`).run(userId)
}

export function incrementMfaAttempts(id: string): number {
  getDb().prepare('UPDATE sessions SET mfa_attempts = mfa_attempts + 1 WHERE id = ?').run(id)
  const row = getDb().prepare('SELECT mfa_attempts FROM sessions WHERE id = ?').get(id) as
    | { mfa_attempts: number }
    | undefined
  return row?.mfa_attempts ?? MAX_MFA_ATTEMPTS
}

export function listUserSessions(userId: number, currentId?: string): SessionInfo[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM sessions WHERE user_id = ? AND stage = 'full' AND expires_at > ? ORDER BY last_seen_at DESC`,
    )
    .all(userId, Date.now()) as SessionRow[]
  return rows.map((s) => ({
    // Nur ein Teil des Hashes nach außen – reicht zur Identifikation
    id: s.id.slice(0, 16),
    createdAt: s.created_at,
    lastSeenAt: s.last_seen_at,
    ip: s.ip,
    userAgent: s.user_agent,
    current: s.id === currentId,
  }))
}

export function deleteUserSessionByPrefix(userId: number, prefix: string): boolean {
  if (!/^[a-f0-9]{16}$/.test(prefix)) return false
  const info = getDb()
    .prepare(`DELETE FROM sessions WHERE user_id = ? AND substr(id, 1, 16) = ?`)
    .run(userId, prefix)
  return info.changes > 0
}

export function purgeExpiredSessions() {
  getDb().prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now())
}
