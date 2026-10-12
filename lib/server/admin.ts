import 'server-only'
import { ApiError, badRequest, notFound } from './http'
import { audit } from './audit'
import { generatePassword } from './crypto'
import { checkPasswordPolicy, hashPassword } from './password'
import { deleteUserSessions } from './session'
import {
  countActiveAdmins,
  createUser,
  deleteUser,
  getUserById,
  getUserByUsername,
  updateUser,
  USERNAME_PATTERN,
  type UserRow,
} from './users'
import type { Role } from '@/lib/shared/types'

type Actor = { user: UserRow; ip: string | null }

function actorFields(actor: Actor) {
  return { actorId: actor.user.id, actorUsername: actor.user.username, ip: actor.ip }
}

function requireUser(id: number): UserRow {
  const user = Number.isInteger(id) ? getUserById(id) : undefined
  if (!user) throw notFound('Benutzer nicht gefunden.')
  return user
}

export async function adminCreateUser(
  actor: Actor,
  input: { username: string; displayName: string; role: Role; password?: string; mfaRequired: boolean },
) {
  const username = input.username.trim()
  if (!USERNAME_PATTERN.test(username)) {
    throw badRequest(
      'Der Benutzername muss 2–32 Zeichen lang sein und darf nur Buchstaben, Ziffern, Punkt, Binde- und Unterstrich enthalten.',
    )
  }
  if (getUserByUsername(username)) throw new ApiError(409, 'username_taken', 'Dieser Benutzername ist bereits vergeben.')
  const password = input.password || generatePassword()
  const policyError = checkPasswordPolicy(password, username)
  if (policyError) throw badRequest(policyError, 'weak_password')

  const user = createUser({
    username,
    displayName: input.displayName,
    role: input.role,
    passwordHash: await hashPassword(password),
    mfaRequired: input.mfaRequired,
    mustChangePassword: true,
  })
  audit({
    event: 'user_created',
    userId: user.id,
    username: user.username,
    ...actorFields(actor),
    details: { role: user.role, mfaRequired: input.mfaRequired },
  })
  return { user, password: input.password ? null : password }
}

export function adminUpdateUser(
  actor: Actor,
  id: number,
  patch: { displayName?: string; role?: Role; isActive?: boolean; mfaRequired?: boolean; unlock?: boolean },
) {
  const user = requireUser(id)
  const isSelf = user.id === actor.user.id
  const changes: Record<string, unknown> = {}

  if (patch.role !== undefined && patch.role !== user.role) {
    if (isSelf) throw badRequest('Du kannst deine eigene Rolle nicht ändern.')
    if (user.role === 'admin' && countActiveAdmins(user.id) === 0) {
      throw badRequest('Es muss mindestens ein aktiver Administrator bestehen bleiben.')
    }
    changes.role = patch.role
  }
  if (patch.isActive !== undefined && patch.isActive !== (user.is_active === 1)) {
    if (isSelf) throw badRequest('Du kannst dein eigenes Konto nicht deaktivieren.')
    if (!patch.isActive && user.role === 'admin' && countActiveAdmins(user.id) === 0) {
      throw badRequest('Es muss mindestens ein aktiver Administrator bestehen bleiben.')
    }
    changes.isActive = patch.isActive
  }
  if (patch.displayName !== undefined && patch.displayName !== user.display_name) changes.displayName = patch.displayName
  if (patch.mfaRequired !== undefined && patch.mfaRequired !== (user.mfa_required === 1)) {
    changes.mfaRequired = patch.mfaRequired
  }

  updateUser(user.id, {
    ...(changes.displayName !== undefined ? { display_name: patch.displayName } : {}),
    ...(changes.role !== undefined ? { role: patch.role } : {}),
    ...(changes.isActive !== undefined ? { is_active: patch.isActive ? 1 : 0 } : {}),
    ...(changes.mfaRequired !== undefined ? { mfa_required: patch.mfaRequired ? 1 : 0 } : {}),
    ...(patch.unlock ? { failed_logins: 0, mfa_failed: 0, locked_until: null } : {}),
  })
  if (patch.unlock) changes.unlocked = true
  if (changes.isActive === false) deleteUserSessions(user.id)

  if (Object.keys(changes).length > 0) {
    audit({ event: 'user_updated', userId: user.id, username: user.username, ...actorFields(actor), details: changes })
  }
  return getUserById(user.id)!
}

export async function adminResetPassword(actor: Actor, id: number, password?: string) {
  const user = requireUser(id)
  const newPassword = password || generatePassword()
  const policyError = checkPasswordPolicy(newPassword, user.username)
  if (policyError) throw badRequest(policyError, 'weak_password')
  updateUser(user.id, {
    password_hash: await hashPassword(newPassword),
    must_change_password: 1,
    password_changed_at: Date.now(),
    failed_logins: 0,
    mfa_failed: 0,
    locked_until: null,
  })
  deleteUserSessions(user.id)
  audit({ event: 'password_reset', userId: user.id, username: user.username, ...actorFields(actor) })
  return { password: password ? null : newPassword }
}

export function adminResetMfa(actor: Actor, id: number) {
  const user = requireUser(id)
  if (user.id === actor.user.id) {
    throw badRequest('Deine eigene Zwei-Faktor-Anmeldung verwaltest du in den Einstellungen.')
  }
  updateUser(user.id, {
    mfa_enabled: 0,
    mfa_secret: null,
    mfa_pending_secret: null,
    mfa_pending_created_at: null,
    mfa_last_step: 0,
    mfa_failed: 0,
    failed_logins: 0,
    locked_until: null,
  })
  deleteUserSessions(user.id)
  audit({ event: 'mfa_reset', userId: user.id, username: user.username, ...actorFields(actor) })
}

export function adminRevokeSessions(actor: Actor, id: number) {
  const user = requireUser(id)
  deleteUserSessions(user.id)
  audit({ event: 'sessions_revoked_by_admin', userId: user.id, username: user.username, ...actorFields(actor) })
}

export function adminDeleteUser(actor: Actor, id: number) {
  const user = requireUser(id)
  if (user.id === actor.user.id) throw badRequest('Du kannst dein eigenes Konto nicht löschen.')
  if (user.role === 'admin' && countActiveAdmins(user.id) === 0) {
    throw badRequest('Es muss mindestens ein aktiver Administrator bestehen bleiben.')
  }
  deleteUser(user.id)
  audit({ event: 'user_deleted', userId: user.id, username: user.username, ...actorFields(actor) })
}
