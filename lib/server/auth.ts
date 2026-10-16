import 'server-only'
import { ApiError, badRequest } from './http'
import { audit } from './audit'
import { decrypt, encrypt } from './crypto'
import { checkPasswordPolicy, hashPassword, verifyDummy, verifyPassword } from './password'
import { ipKey, isRateLimited, rateLimit, resetRateLimit } from './rate-limit'
import {
  createSession,
  deleteMfaStageSessions,
  deleteSession,
  deleteUserSessions,
  incrementMfaAttempts,
  MAX_MFA_ATTEMPTS,
  type SessionRow,
} from './session'
import { generateTotpSecret, totpQrDataUrl, totpUri, verifyTotp } from './totp'
import { getUserById, getUserByUsername, isMfaRequired, pendingSetup, updateUser, type UserRow } from './users'
import { getConfig } from './config'

/** Fehlversuche (alle IPs zusammen), ab denen das Konto gesperrt wird */
const LOCK_THRESHOLD = 50
const LOCK_DURATION_MS = 15 * 60 * 1000
/** Fehlversuche pro Benutzer und IP-Adresse innerhalb von 15 Minuten */
const USER_IP_LIMIT = 10
/** Fehlversuche pro IP-Adresse (alle Benutzer) innerhalb von 15 Minuten */
const IP_FAILURE_LIMIT = 30
const LOGIN_WINDOW_MS = 15 * 60_000
/** Ab so vielen falschen MFA-Codes wird gesperrt – jede weitere Sperre dauert doppelt so lang (max. 24 h). */
const MFA_LOCK_THRESHOLD = 5
const MFA_LOCK_MAX_MS = 24 * 60 * 60 * 1000
const MFA_SETUP_TTL_MS = 15 * 60 * 1000

type Meta = { ip: string | null; userAgent: string | null }

function minutes(ms: number) {
  return Math.max(1, Math.ceil(ms / 60_000))
}

function registerFailure(user: UserRow, ip: string | null) {
  const t = Date.now()
  const previous = user.locked_until && user.locked_until <= t ? 0 : user.failed_logins
  const failed = previous + 1
  const lockedUntil = failed >= LOCK_THRESHOLD ? t + LOCK_DURATION_MS : null
  updateUser(user.id, { failed_logins: failed, locked_until: lockedUntil })
  audit({ event: 'login_failed', userId: user.id, username: user.username, ip, details: { failed } })
  if (lockedUntil) audit({ event: 'login_locked', userId: user.id, username: user.username, ip })
}

/**
 * Falsche MFA-Codes: Wer hier landet, kennt das Passwort bereits. Der Zähler wird erst nach einer
 * erfolgreichen Anmeldung zurückgesetzt, die Sperre verdoppelt sich mit jedem weiteren Fehlversuch.
 */
function registerMfaFailure(user: UserRow, ip: string | null) {
  const failed = user.mfa_failed + 1
  const lockedUntil =
    failed >= MFA_LOCK_THRESHOLD
      ? Date.now() + Math.min(MFA_LOCK_MAX_MS, LOCK_DURATION_MS * 2 ** (failed - MFA_LOCK_THRESHOLD))
      : user.locked_until
  updateUser(user.id, { mfa_failed: failed, locked_until: lockedUntil })
  audit({ event: 'mfa_failed', userId: user.id, username: user.username, ip, details: { failed } })
  if (failed >= MFA_LOCK_THRESHOLD) audit({ event: 'login_locked', userId: user.id, username: user.username, ip })
}

function checkLocked(user: UserRow) {
  if (user.locked_until && user.locked_until > Date.now()) {
    throw new ApiError(
      429,
      'locked',
      `Zu viele Fehlversuche. Bitte versuche es in ${minutes(user.locked_until - Date.now())} Minuten erneut.`,
    )
  }
}

export type LoginResult =
  | { status: 'mfa'; token: string }
  | { status: 'ok'; token: string; setup: 'password' | 'mfa' | null; user: UserRow }

export async function login(username: string, password: string, meta: Meta): Promise<LoginResult> {
  const name = username.trim().toLowerCase().slice(0, 64)
  const ip = ipKey(meta.ip)
  const userKey = `login-user:${name}:${ip}`
  // Pro IP zählen nur Fehlversuche (viele Studierende teilen sich z. B. eine NAT-Adresse im Uni-WLAN)
  const ipBucket = `login-ip:${ip}`
  if (isRateLimited(ipBucket, IP_FAILURE_LIMIT)) {
    throw new ApiError(429, 'rate_limited', 'Zu viele fehlgeschlagene Anmeldeversuche. Bitte warte 15 Minuten.')
  }
  const fail = () => {
    rateLimit(ipBucket, IP_FAILURE_LIMIT, LOGIN_WINDOW_MS)
    rateLimit(userKey, USER_IP_LIMIT, LOGIN_WINDOW_MS)
  }
  // Fehlversuche pro Benutzer *und* IP: Ein Angreifer kann so das Konto nicht für alle anderen sperren
  if (isRateLimited(userKey, USER_IP_LIMIT)) {
    throw new ApiError(429, 'rate_limited', 'Zu viele Fehlversuche. Bitte warte 15 Minuten.')
  }

  const found = getUserByUsername(name)
  if (!found) {
    await verifyDummy(password)
    fail()
    audit({ event: 'login_failed', username: name, ip: meta.ip, details: { reason: 'unknown_user' } })
    throw new ApiError(401, 'invalid_credentials', 'Benutzername oder Passwort ist falsch.')
  }
  checkLocked(found)

  const passwordOk = await verifyPassword(found.password_hash, password)
  // Nach dem await neu lesen – parallele Anfragen sollen sich nicht gegenseitig überschreiben
  const user = getUserById(found.id)
  if (!user) throw new ApiError(401, 'invalid_credentials', 'Benutzername oder Passwort ist falsch.')
  checkLocked(user)
  if (!passwordOk) {
    fail()
    registerFailure(user, meta.ip)
    throw new ApiError(401, 'invalid_credentials', 'Benutzername oder Passwort ist falsch.')
  }
  if (!user.is_active) {
    audit({ event: 'login_inactive', userId: user.id, username: user.username, ip: meta.ip })
    throw new ApiError(403, 'inactive', 'Dieses Konto ist deaktiviert. Wende dich an den Administrator.')
  }

  updateUser(user.id, { failed_logins: 0 })
  resetRateLimit(userKey)

  if (user.mfa_enabled) {
    // Höchstens eine offene MFA-Abfrage pro Benutzer (sonst ließen sich Codes parallel durchprobieren)
    deleteMfaStageSessions(user.id)
    const { token } = createSession(user.id, 'mfa', meta)
    return { status: 'mfa', token }
  }
  const { token } = createSession(user.id, 'full', meta)
  updateUser(user.id, { last_login_at: Date.now() })
  audit({ event: 'login_success', userId: user.id, username: user.username, ip: meta.ip, details: { mfa: false } })
  return { status: 'ok', token, setup: pendingSetup(user), user }
}

export async function completeMfaLogin(
  session: SessionRow,
  staleUser: UserRow,
  code: string,
  meta: Meta,
): Promise<{ token: string; setup: 'password' | 'mfa' | null }> {
  // Frisch lesen: Ab hier läuft alles synchron, parallele Anfragen zählen also korrekt mit
  const user = getUserById(staleUser.id)
  if (!user) throw new ApiError(401, 'unauthorized', 'Bitte melde dich an.')
  const attempts = incrementMfaAttempts(session.id)
  if (attempts > MAX_MFA_ATTEMPTS) {
    deleteSession(session.id)
    throw new ApiError(429, 'too_many_attempts', 'Zu viele falsche Codes. Bitte melde dich erneut an.')
  }
  checkLocked(user)
  if (!user.mfa_enabled || !user.mfa_secret) {
    deleteSession(session.id)
    throw new ApiError(400, 'mfa_not_enabled', 'MFA ist nicht mehr aktiv. Bitte melde dich erneut an.')
  }
  const result = verifyTotp(decrypt(user.mfa_secret), code, user.mfa_last_step)
  if (!result.ok) {
    registerMfaFailure(user, meta.ip)
    throw new ApiError(401, 'invalid_code', 'Der Code ist ungültig oder abgelaufen.')
  }
  updateUser(user.id, {
    mfa_last_step: result.step,
    failed_logins: 0,
    mfa_failed: 0,
    locked_until: null,
    last_login_at: Date.now(),
  })
  deleteSession(session.id)
  const { token } = createSession(user.id, 'full', meta)
  audit({ event: 'login_success', userId: user.id, username: user.username, ip: meta.ip, details: { mfa: true } })
  return { token, setup: pendingSetup(getUserById(user.id)!) }
}

export async function changePassword(
  user: UserRow,
  session: SessionRow,
  currentPassword: string,
  newPassword: string,
  ip: string | null,
) {
  const limit = rateLimit(`pw-change:${user.id}`, 10, 15 * 60_000)
  if (!limit.ok) throw new ApiError(429, 'rate_limited', 'Zu viele Versuche. Bitte warte einen Moment.')
  if (!(await verifyPassword(user.password_hash, currentPassword))) {
    throw new ApiError(400, 'wrong_password', 'Das aktuelle Passwort ist falsch.')
  }
  const policyError = checkPasswordPolicy(newPassword, user.username)
  if (policyError) throw badRequest(policyError, 'weak_password')
  if (newPassword === currentPassword) throw badRequest('Das neue Passwort muss sich vom alten unterscheiden.')

  updateUser(user.id, {
    password_hash: await hashPassword(newPassword),
    must_change_password: 0,
    password_changed_at: Date.now(),
  })
  // Alle anderen Sitzungen abmelden
  deleteUserSessions(user.id, session.id)
  audit({ event: 'password_changed', userId: user.id, username: user.username, actorId: user.id, ip })
}

export async function startMfaSetup(user: UserRow) {
  if (user.mfa_enabled) throw new ApiError(409, 'mfa_already_enabled', 'Die Zwei-Faktor-Anmeldung ist bereits aktiv.')
  const secret = generateTotpSecret()
  updateUser(user.id, { mfa_pending_secret: encrypt(secret), mfa_pending_created_at: Date.now() })
  const uri = totpUri(secret, user.username, getConfig().appName)
  return { secret, uri, qrDataUrl: await totpQrDataUrl(uri) }
}

export function confirmMfaSetup(user: UserRow, session: SessionRow, code: string, ip: string | null) {
  const limit = rateLimit(`mfa-setup:${user.id}`, 10, 10 * 60_000)
  if (!limit.ok) throw new ApiError(429, 'rate_limited', 'Zu viele Versuche. Bitte warte einen Moment.')
  if (user.mfa_enabled) throw new ApiError(409, 'mfa_already_enabled', 'Die Zwei-Faktor-Anmeldung ist bereits aktiv.')
  if (
    !user.mfa_pending_secret ||
    !user.mfa_pending_created_at ||
    Date.now() - user.mfa_pending_created_at > MFA_SETUP_TTL_MS
  ) {
    throw new ApiError(400, 'mfa_setup_expired', 'Die Einrichtung ist abgelaufen. Bitte starte sie neu.')
  }
  const secret = decrypt(user.mfa_pending_secret)
  const result = verifyTotp(secret, code, 0)
  if (!result.ok) throw new ApiError(400, 'invalid_code', 'Der Code ist ungültig. Prüfe die Uhrzeit deines Geräts.')
  updateUser(user.id, {
    mfa_enabled: 1,
    mfa_secret: encrypt(secret),
    mfa_pending_secret: null,
    mfa_pending_created_at: null,
    mfa_last_step: result.step,
  })
  deleteUserSessions(user.id, session.id)
  audit({ event: 'mfa_enabled', userId: user.id, username: user.username, actorId: user.id, ip })
}

export async function disableMfa(user: UserRow, password: string, code: string, ip: string | null) {
  const limit = rateLimit(`mfa-disable:${user.id}`, 10, 15 * 60_000)
  if (!limit.ok) throw new ApiError(429, 'rate_limited', 'Zu viele Versuche. Bitte warte einen Moment.')
  if (!user.mfa_enabled || !user.mfa_secret) throw badRequest('Die Zwei-Faktor-Anmeldung ist nicht aktiv.')
  if (isMfaRequired(user)) {
    throw new ApiError(403, 'mfa_required', 'Die Zwei-Faktor-Anmeldung ist für dein Konto vorgeschrieben.')
  }
  if (!(await verifyPassword(user.password_hash, password))) {
    throw new ApiError(400, 'wrong_password', 'Das Passwort ist falsch.')
  }
  const result = verifyTotp(decrypt(user.mfa_secret), code, user.mfa_last_step)
  if (!result.ok) throw new ApiError(400, 'invalid_code', 'Der Code ist ungültig oder abgelaufen.')
  updateUser(user.id, { mfa_enabled: 0, mfa_secret: null, mfa_last_step: 0 })
  audit({ event: 'mfa_disabled', userId: user.id, username: user.username, actorId: user.id, ip })
}
