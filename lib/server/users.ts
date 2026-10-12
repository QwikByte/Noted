import 'server-only'
import fs from 'node:fs'
import path from 'node:path'
import { getDb } from './db'
import { getSettings } from './settings'
import { getConfig } from './config'
import type { AdminUser, PublicUser, Role } from '@/lib/shared/types'

export type UserRow = {
  id: number
  username: string
  display_name: string
  password_hash: string
  role: Role
  is_active: number
  must_change_password: number
  mfa_enabled: number
  mfa_secret: string | null
  mfa_pending_secret: string | null
  mfa_pending_created_at: number | null
  mfa_last_step: number
  mfa_required: number
  failed_logins: number
  mfa_failed: number
  locked_until: number | null
  last_login_at: number | null
  password_changed_at: number | null
  created_at: number
  updated_at: number
}

export const USERNAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,31}$/

export function getUserById(id: number): UserRow | undefined {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
}

export function getUserByUsername(username: string): UserRow | undefined {
  return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username.trim()) as UserRow | undefined
}

/** MFA ist für diesen Benutzer verpflichtend (Admin-Vorgabe oder globale Einstellung). */
export function isMfaRequired(user: UserRow, enforceAll = getSettings().enforceMfa): boolean {
  return enforceAll || user.mfa_required === 1
}

/** Der Benutzer muss vor der normalen Nutzung noch etwas erledigen. */
export function pendingSetup(user: UserRow): 'password' | 'mfa' | null {
  if (user.must_change_password) return 'password'
  if (isMfaRequired(user) && !user.mfa_enabled) return 'mfa'
  return null
}

export function toPublicUser(user: UserRow, enforceAll = getSettings().enforceMfa): PublicUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name || user.username,
    role: user.role,
    mfaEnabled: user.mfa_enabled === 1,
    mfaRequired: isMfaRequired(user, enforceAll),
    mustChangePassword: user.must_change_password === 1,
  }
}

export function listUsersForAdmin(): AdminUser[] {
  const enforceAll = getSettings().enforceMfa
  const rows = getDb()
    .prepare(
      `SELECT u.*, (SELECT COUNT(*) FROM notes n WHERE n.user_id = u.id AND n.deleted_at IS NULL) AS note_count
       FROM users u ORDER BY u.username COLLATE NOCASE`,
    )
    .all() as (UserRow & { note_count: number })[]
  const t = Date.now()
  return rows.map((u) => ({
    ...toPublicUser(u, enforceAll),
    isActive: u.is_active === 1,
    mfaRequiredByAdmin: u.mfa_required === 1,
    lockedUntil: u.locked_until && u.locked_until > t ? u.locked_until : null,
    lastLoginAt: u.last_login_at,
    createdAt: u.created_at,
    noteCount: u.note_count,
  }))
}

export function createUser(input: {
  username: string
  displayName: string
  passwordHash: string
  role: Role
  mfaRequired: boolean
  mustChangePassword: boolean
}): UserRow {
  const t = Date.now()
  const info = getDb()
    .prepare(
      `INSERT INTO users (username, display_name, password_hash, role, mfa_required, must_change_password,
                          created_at, updated_at, password_changed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.username.trim(),
      input.displayName.trim(),
      input.passwordHash,
      input.role,
      input.mfaRequired ? 1 : 0,
      input.mustChangePassword ? 1 : 0,
      t,
      t,
      t,
    )
  return getUserById(Number(info.lastInsertRowid))!
}

type UserPatch = Partial<{
  display_name: string
  role: Role
  is_active: number
  must_change_password: number
  mfa_required: number
  password_hash: string
  password_changed_at: number
  mfa_enabled: number
  mfa_secret: string | null
  mfa_pending_secret: string | null
  mfa_pending_created_at: number | null
  mfa_last_step: number
  failed_logins: number
  mfa_failed: number
  locked_until: number | null
  last_login_at: number
}>

const PATCHABLE = new Set([
  'display_name',
  'role',
  'is_active',
  'must_change_password',
  'mfa_required',
  'password_hash',
  'password_changed_at',
  'mfa_enabled',
  'mfa_secret',
  'mfa_pending_secret',
  'mfa_pending_created_at',
  'mfa_last_step',
  'failed_logins',
  'mfa_failed',
  'locked_until',
  'last_login_at',
])

export function updateUser(id: number, patch: UserPatch) {
  const keys = Object.keys(patch).filter((k) => PATCHABLE.has(k))
  if (keys.length === 0) return
  const sets = keys.map((k) => `${k} = @${k}`).join(', ')
  getDb()
    .prepare(`UPDATE users SET ${sets}, updated_at = @updated_at WHERE id = @id`)
    .run({ ...patch, updated_at: Date.now(), id })
}

export function countActiveAdmins(excludeId?: number): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1 AND id != ?`)
    .get(excludeId ?? -1) as { n: number }
  return row.n
}

export function deleteUser(id: number) {
  const db = getDb()
  db.transaction(() => {
    db.prepare('DELETE FROM notes_fts_map WHERE note_id IN (SELECT id FROM notes WHERE user_id = ?)').run(id)
    db.prepare('DELETE FROM notes_fts WHERE user_id = ?').run(id)
    db.prepare('DELETE FROM users WHERE id = ?').run(id)
  })()
  const dir = path.join(getConfig().attachmentsDir, String(id))
  fs.rmSync(dir, { recursive: true, force: true })
}
