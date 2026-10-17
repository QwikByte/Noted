import 'server-only'
import { getDb } from './db'

export type AuditEvent =
  | 'login_success'
  | 'login_failed'
  | 'login_locked'
  | 'login_inactive'
  | 'mfa_failed'
  | 'logout'
  | 'password_changed'
  | 'mfa_enabled'
  | 'mfa_disabled'
  | 'session_revoked'
  | 'user_created'
  | 'user_updated'
  | 'user_deleted'
  | 'password_reset'
  | 'mfa_reset'
  | 'sessions_revoked_by_admin'
  | 'settings_changed'
  | 'update_requested'

export type AuditEntry = {
  event: AuditEvent
  userId?: number | null
  username?: string | null
  actorId?: number | null
  actorUsername?: string | null
  ip?: string | null
  details?: Record<string, unknown> | string | null
}

export function audit(entry: AuditEntry) {
  try {
    const db = getDb()
    db.prepare(
      `INSERT INTO audit_log (created_at, event, user_id, username, actor_id, actor_username, ip, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      Date.now(),
      entry.event,
      entry.userId ?? null,
      entry.username ?? null,
      entry.actorId ?? null,
      entry.actorUsername ?? null,
      entry.ip ?? null,
      entry.details == null ? null : typeof entry.details === 'string' ? entry.details : JSON.stringify(entry.details),
    )
    // Protokoll begrenzen: max. 180 Tage bzw. 20.000 Einträge
    if (Math.random() < 0.02) {
      db.prepare('DELETE FROM audit_log WHERE created_at < ?').run(Date.now() - 180 * 86_400_000)
      db.prepare('DELETE FROM audit_log WHERE id <= (SELECT MAX(id) FROM audit_log) - 20000').run()
    }
  } catch (err) {
    console.error('[noted] Audit-Log fehlgeschlagen', err)
  }
}

export type AuditRow = {
  id: number
  createdAt: number
  event: AuditEvent
  userId: number | null
  username: string | null
  actorId: number | null
  actorUsername: string | null
  ip: string | null
  details: string | null
}

export function listAudit(limit = 200, before?: number): AuditRow[] {
  const rows = getDb()
    .prepare(
      `SELECT id, created_at AS createdAt, event, user_id AS userId, username, actor_id AS actorId,
              actor_username AS actorUsername, ip, details
       FROM audit_log ${before ? 'WHERE id < ?' : ''} ORDER BY id DESC LIMIT ?`,
    )
    .all(...(before ? [before, limit] : [limit])) as AuditRow[]
  return rows
}
