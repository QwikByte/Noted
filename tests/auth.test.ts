import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ADMIN_PASSWORD, call, loginAs, setupTestEnv } from './helpers'
import * as login from '@/app/api/auth/login/route'
import * as mfa from '@/app/api/auth/mfa/route'
import * as logout from '@/app/api/auth/logout/route'
import * as me from '@/app/api/auth/me/route'
import * as password from '@/app/api/account/password/route'
import * as mfaSetup from '@/app/api/account/mfa/setup/route'
import * as mfaEnable from '@/app/api/account/mfa/enable/route'
import * as mfaDisable from '@/app/api/account/mfa/disable/route'
import * as sessions from '@/app/api/account/sessions/route'
import * as users from '@/app/api/admin/users/route'
import * as user from '@/app/api/admin/users/[id]/route'
import * as userPassword from '@/app/api/admin/users/[id]/password/route'
import * as userMfa from '@/app/api/admin/users/[id]/mfa/route'
import * as settings from '@/app/api/admin/settings/route'
import * as audit from '@/app/api/admin/audit/route'
import * as notes from '@/app/api/notes/route'
import { generateTotpCode } from '@/lib/server/totp'
import { clearAllRateLimits } from '@/lib/server/rate-limit'

let env: Awaited<ReturnType<typeof setupTestEnv>>
beforeAll(async () => {
  env = await setupTestEnv()
})
afterAll(() => env.cleanup())

async function createUser(adminToken: string, body: Record<string, unknown>) {
  const r = await call(users.POST, '/api/admin/users', { cookie: adminToken, body })
  expect(r.status).toBe(201)
  return r.data as { user: { id: number; username: string }; password: string | null }
}

describe('Anmeldung', () => {
  it('legt beim ersten Start einen Admin an und erlaubt die Anmeldung', async () => {
    const r = await call(login.POST, '/api/auth/login', { body: { username: 'admin', password: ADMIN_PASSWORD } })
    expect(r.status).toBe(200)
    expect(r.data.status).toBe('ok')
    expect(r.token).toBeTruthy()
    const cookie = r.res.headers.get('set-cookie')!
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=lax/i)

    const who = await call(me.GET, '/api/auth/me', { cookie: r.token })
    expect(who.data.user.username).toBe('admin')
    expect(who.data.user.role).toBe('admin')
  })

  it('akzeptiert Benutzernamen ohne Beachtung der Groß-/Kleinschreibung', async () => {
    const r = await call(login.POST, '/api/auth/login', { body: { username: 'ADMIN', password: ADMIN_PASSWORD } })
    expect(r.status).toBe(200)
  })

  it('lehnt falsche Passwörter und unbekannte Benutzer mit derselben Meldung ab', async () => {
    const a = await call(login.POST, '/api/auth/login', { body: { username: 'admin', password: 'falsch' } })
    const b = await call(login.POST, '/api/auth/login', { body: { username: 'gibtsnicht', password: 'falsch' } })
    expect(a.status).toBe(401)
    expect(b.status).toBe(401)
    expect(a.data.message).toBe(b.data.message)
  })

  it('verlangt eine Anmeldung für geschützte Endpunkte', async () => {
    expect((await call(me.GET, '/api/auth/me')).status).toBe(401)
    expect((await call(notes.GET, '/api/notes')).status).toBe(401)
    expect((await call(notes.GET, '/api/notes', { cookie: 'ungueltig' })).status).toBe(401)
  })

  it('blockiert schreibende Anfragen ohne CSRF-Header oder von fremden Seiten', async () => {
    const token = await loginAs('admin', ADMIN_PASSWORD)
    const noHeader = await call(notes.POST, '/api/notes', { cookie: token, body: { title: 'x' }, csrf: false })
    expect(noHeader.status).toBe(403)
    const foreign = await call(notes.POST, '/api/notes', {
      cookie: token,
      body: { title: 'x' },
      headers: { origin: 'https://evil.example' },
    })
    expect(foreign.status).toBe(403)
    const sameOrigin = await call(notes.POST, '/api/notes', {
      cookie: token,
      body: { title: 'ok' },
      headers: { origin: 'http://localhost:3000' },
    })
    expect(sameOrigin.status).toBe(201)
  })

  it('meldet ab und macht die Sitzung ungültig', async () => {
    const token = await loginAs('admin', ADMIN_PASSWORD)
    expect((await call(logout.POST, '/api/auth/logout', { cookie: token })).status).toBe(200)
    expect((await call(me.GET, '/api/auth/me', { cookie: token })).status).toBe(401)
  })
})

describe('Benutzerverwaltung', () => {
  it('nur Admins dürfen Benutzer verwalten', async () => {
    const admin = await loginAs('admin', ADMIN_PASSWORD)
    await createUser(admin, { username: 'lisa', displayName: 'Lisa', password: 'Start-Kennwort-111' })
    const lisa = await loginAs('lisa', 'Start-Kennwort-111')
    // Startpasswort muss zuerst geändert werden
    const blocked = await call(users.GET, '/api/admin/users', { cookie: lisa })
    expect(blocked.status).toBe(403)
    expect(blocked.data.error).toBe('setup_required')
    await call(password.POST, '/api/account/password', {
      cookie: lisa,
      body: { currentPassword: 'Start-Kennwort-111', newPassword: 'Neues-Kennwort-222' },
    })
    const forbidden = await call(users.GET, '/api/admin/users', { cookie: lisa })
    expect(forbidden.status).toBe(403)
    expect(forbidden.data.error).toBe('forbidden')
  })

  it('erzwingt die Passwortänderung bei generiertem Startpasswort', async () => {
    const admin = await loginAs('admin', ADMIN_PASSWORD)
    const created = await createUser(admin, { username: 'max', displayName: 'Max' })
    expect(created.password).toMatch(/^[\w]{4}(-[\w]{4}){3}$/)

    const loginRes = await call(login.POST, '/api/auth/login', {
      body: { username: 'max', password: created.password },
    })
    expect(loginRes.data.setup).toBe('password')
    const token = loginRes.token!
    expect((await call(notes.GET, '/api/notes', { cookie: token })).status).toBe(403)

    const weak = await call(password.POST, '/api/account/password', {
      cookie: token,
      body: { currentPassword: created.password, newPassword: 'kurz' },
    })
    expect(weak.status).toBe(400)
    const wrong = await call(password.POST, '/api/account/password', {
      cookie: token,
      body: { currentPassword: 'falsch', newPassword: 'Ein-gutes-Passwort-9' },
    })
    expect(wrong.status).toBe(400)
    const ok = await call(password.POST, '/api/account/password', {
      cookie: token,
      body: { currentPassword: created.password, newPassword: 'Ein-gutes-Passwort-9' },
    })
    expect(ok.status).toBe(200)
    expect((await call(notes.GET, '/api/notes', { cookie: token })).status).toBe(200)
  })

  it('verhindert doppelte Benutzernamen und ungültige Namen', async () => {
    const admin = await loginAs('admin', ADMIN_PASSWORD)
    const dup = await call(users.POST, '/api/admin/users', { cookie: admin, body: { username: 'MAX' } })
    expect(dup.status).toBe(409)
    const invalid = await call(users.POST, '/api/admin/users', { cookie: admin, body: { username: 'mit leerzeichen' } })
    expect(invalid.status).toBe(400)
  })

  it('schützt den letzten Admin und das eigene Konto', async () => {
    const admin = await loginAs('admin', ADMIN_PASSWORD)
    const list = await call(users.GET, '/api/admin/users', { cookie: admin })
    const adminId = list.data.users.find((u: { username: string }) => u.username === 'admin').id
    const del = await call(user.DELETE, `/api/admin/users/${adminId}`, {
      method: 'DELETE',
      cookie: admin,
      params: { id: String(adminId) },
    })
    expect(del.status).toBe(400)
    const demote = await call(user.PATCH, `/api/admin/users/${adminId}`, {
      method: 'PATCH',
      cookie: admin,
      params: { id: String(adminId) },
      body: { role: 'user' },
    })
    expect(demote.status).toBe(400)
  })

  it('deaktiviert Konten und beendet deren Sitzungen', async () => {
    const admin = await loginAs('admin', ADMIN_PASSWORD)
    const created = await createUser(admin, { username: 'tom', password: 'Geheimes-Wort-333' })
    const tom = await loginAs('tom', 'Geheimes-Wort-333')
    const id = String(created.user.id)
    await call(user.PATCH, `/api/admin/users/${id}`, {
      method: 'PATCH',
      cookie: admin,
      params: { id },
      body: { isActive: false },
    })
    expect((await call(me.GET, '/api/auth/me', { cookie: tom })).status).toBe(401)
    const again = await call(login.POST, '/api/auth/login', { body: { username: 'tom', password: 'Geheimes-Wort-333' } })
    expect(again.status).toBe(403)
    expect(again.data.error).toBe('inactive')
  })

  it('setzt Passwörter zurück und erzwingt eine Änderung', async () => {
    const admin = await loginAs('admin', ADMIN_PASSWORD)
    const created = await createUser(admin, { username: 'eva', password: 'Geheimes-Wort-444' })
    const id = String(created.user.id)
    const reset = await call(userPassword.POST, `/api/admin/users/${id}/password`, {
      cookie: admin,
      params: { id },
      body: {},
    })
    expect(reset.status).toBe(200)
    expect(reset.data.password).toBeTruthy()
    const r = await call(login.POST, '/api/auth/login', { body: { username: 'eva', password: reset.data.password } })
    expect(r.data.setup).toBe('password')
  })

  it('sperrt Konten nach zu vielen Fehlversuchen und kann sie entsperren', async () => {
    const admin = await loginAs('admin', ADMIN_PASSWORD)
    const created = await createUser(admin, { username: 'paul', password: 'Geheimes-Wort-555' })
    for (let i = 0; i < 10; i++) {
      await call(login.POST, '/api/auth/login', { body: { username: 'paul', password: 'falsch' } })
    }
    clearAllRateLimits()
    const locked = await call(login.POST, '/api/auth/login', { body: { username: 'paul', password: 'Geheimes-Wort-555' } })
    expect(locked.status).toBe(429)
    expect(locked.data.error).toBe('locked')
    const id = String(created.user.id)
    await call(user.PATCH, `/api/admin/users/${id}`, { method: 'PATCH', cookie: admin, params: { id }, body: { unlock: true } })
    const ok = await call(login.POST, '/api/auth/login', { body: { username: 'paul', password: 'Geheimes-Wort-555' } })
    expect(ok.status).toBe(200)
  })

  it('protokolliert sicherheitsrelevante Ereignisse', async () => {
    const admin = await loginAs('admin', ADMIN_PASSWORD)
    const r = await call(audit.GET, '/api/admin/audit', { cookie: admin })
    const events = r.data.entries.map((e: { event: string }) => e.event)
    expect(events).toContain('login_success')
    expect(events).toContain('login_failed')
    expect(events).toContain('user_created')
    expect(events).toContain('login_locked')
  })
})

describe('Zwei-Faktor-Anmeldung (TOTP)', () => {
  let secret = ''
  let token = ''

  it('richtet MFA mit QR-Code und Bestätigungscode ein', async () => {
    const admin = await loginAs('admin', ADMIN_PASSWORD)
    await createUser(admin, { username: 'anna', password: 'Geheimes-Wort-666' })
    token = await loginAs('anna', 'Geheimes-Wort-666')
    await call(password.POST, '/api/account/password', {
      cookie: token,
      body: { currentPassword: 'Geheimes-Wort-666', newPassword: 'Geheimes-Wort-777' },
    })
    const start = await call(mfaSetup.POST, '/api/account/mfa/setup', { cookie: token })
    expect(start.status).toBe(200)
    expect(start.data.qrDataUrl).toMatch(/^data:image\/png;base64,/)
    expect(start.data.uri).toMatch(/^otpauth:\/\/totp\//)
    secret = start.data.secret

    const wrong = await call(mfaEnable.POST, '/api/account/mfa/enable', { cookie: token, body: { code: '000000' } })
    expect(wrong.status).toBe(400)
    const ok = await call(mfaEnable.POST, '/api/account/mfa/enable', {
      cookie: token,
      body: { code: generateTotpCode(secret, Date.now() - 30_000) },
    })
    expect(ok.status).toBe(200)
    expect((await call(me.GET, '/api/auth/me', { cookie: token })).data.user.mfaEnabled).toBe(true)
  })

  it('verlangt nach dem Passwort den Code und verhindert Wiederverwendung', async () => {
    const step1 = await call(login.POST, '/api/auth/login', { body: { username: 'anna', password: 'Geheimes-Wort-777' } })
    expect(step1.data.status).toBe('mfa')
    const pending = step1.token!
    // Halb angemeldete Sitzungen haben keinen Zugriff
    expect((await call(notes.GET, '/api/notes', { cookie: pending })).status).toBe(401)
    expect((await call(me.GET, '/api/auth/me', { cookie: pending })).status).toBe(401)

    const bad = await call(mfa.POST, '/api/auth/mfa', { cookie: pending, body: { code: '123456' } })
    expect(bad.status).toBe(401)
    const code = generateTotpCode(secret)
    const good = await call(mfa.POST, '/api/auth/mfa', { cookie: pending, body: { code } })
    expect(good.status).toBe(200)
    expect(good.token).toBeTruthy()
    expect(good.token).not.toBe(pending)
    expect((await call(notes.GET, '/api/notes', { cookie: good.token })).status).toBe(200)
    // Die MFA-Zwischensitzung ist verbraucht
    expect((await call(mfa.POST, '/api/auth/mfa', { cookie: pending, body: { code } })).status).toBe(401)

    // Derselbe Code darf nicht erneut funktionieren
    const again = await call(login.POST, '/api/auth/login', { body: { username: 'anna', password: 'Geheimes-Wort-777' } })
    const replay = await call(mfa.POST, '/api/auth/mfa', { cookie: again.token, body: { code } })
    expect(replay.status).toBe(401)
    token = good.token!
  })

  it('beendet die MFA-Zwischensitzung nach zu vielen Fehlversuchen', async () => {
    clearAllRateLimits()
    const step1 = await call(login.POST, '/api/auth/login', { body: { username: 'anna', password: 'Geheimes-Wort-777' } })
    for (let i = 0; i < 5; i++) {
      await call(mfa.POST, '/api/auth/mfa', { cookie: step1.token, body: { code: '000000' } })
    }
    const r = await call(mfa.POST, '/api/auth/mfa', { cookie: step1.token, body: { code: generateTotpCode(secret) } })
    expect(r.status).toBe(429)
  })

  it('sperrt das Konto nach wiederholt falschen Codes immer länger', async () => {
    const { getUserByUsername } = await import('@/lib/server/users')
    const before = getUserByUsername('anna')!
    expect(before.mfa_failed).toBeGreaterThanOrEqual(5)
    expect(before.locked_until! - Date.now()).toBeGreaterThan(14 * 60_000)
    // Auch mit richtigem Passwort ist während der Sperre keine Anmeldung möglich
    clearAllRateLimits()
    const locked = await call(login.POST, '/api/auth/login', { body: { username: 'anna', password: 'Geheimes-Wort-777' } })
    expect(locked.status).toBe(429)
  })

  it('erlaubt das Deaktivieren nur mit Passwort und Code', async () => {
    clearAllRateLimits()
    const admin = await loginAs('admin', ADMIN_PASSWORD)
    const list = await call(users.GET, '/api/admin/users', { cookie: admin })
    const anna = list.data.users.find((u: { username: string }) => u.username === 'anna')
    // Fehlversuche aus dem vorherigen Test zurücksetzen
    await call(user.PATCH, '/', { method: 'PATCH', cookie: admin, params: { id: String(anna.id) }, body: { unlock: true } })

    const noCode = await call(mfaDisable.POST, '/api/account/mfa/disable', {
      cookie: token,
      body: { password: 'Geheimes-Wort-777', code: '000000' },
    })
    expect(noCode.status).toBe(400)
  })

  it('Admin kann MFA zurücksetzen (z. B. Handy verloren)', async () => {
    const admin = await loginAs('admin', ADMIN_PASSWORD)
    const list = await call(users.GET, '/api/admin/users', { cookie: admin })
    const anna = list.data.users.find((u: { username: string }) => u.username === 'anna')
    const r = await call(userMfa.DELETE, '/', { method: 'DELETE', cookie: admin, params: { id: String(anna.id) } })
    expect(r.status).toBe(200)
    // Sitzungen wurden beendet, Login wieder ohne Code möglich
    expect((await call(me.GET, '/api/auth/me', { cookie: token })).status).toBe(401)
    const relogin = await call(login.POST, '/api/auth/login', { body: { username: 'anna', password: 'Geheimes-Wort-777' } })
    expect(relogin.data.status).toBe('ok')
  })

  it('erzwingt die MFA-Einrichtung, wenn der Admin sie global vorschreibt', async () => {
    const admin = await loginAs('admin', ADMIN_PASSWORD)
    await call(settings.PATCH, '/api/admin/settings', { method: 'PATCH', cookie: admin, body: { enforceMfa: true } })

    const anna = await loginAs('anna', 'Geheimes-Wort-777')
    const blocked = await call(notes.GET, '/api/notes', { cookie: anna })
    expect(blocked.status).toBe(403)
    expect(blocked.data.setup).toBe('mfa')

    const start = await call(mfaSetup.POST, '/api/account/mfa/setup', { cookie: anna })
    await call(mfaEnable.POST, '/api/account/mfa/enable', {
      cookie: anna,
      body: { code: generateTotpCode(start.data.secret) },
    })
    expect((await call(notes.GET, '/api/notes', { cookie: anna })).status).toBe(200)

    // Pflicht-MFA kann nicht selbst deaktiviert werden
    const disable = await call(mfaDisable.POST, '/api/account/mfa/disable', {
      cookie: anna,
      body: { password: 'Geheimes-Wort-777', code: generateTotpCode(start.data.secret, Date.now() + 30_000) },
    })
    expect(disable.status).toBe(403)

    // Auch der Admin selbst muss MFA einrichten
    const adminBlocked = await call(users.GET, '/api/admin/users', { cookie: admin })
    expect(adminBlocked.status).toBe(403)
    expect(adminBlocked.data.setup).toBe('mfa')
    await call(settings.PATCH, '/api/admin/settings', { method: 'PATCH', cookie: admin, body: { enforceMfa: false } })
  })

  it('listet eigene Sitzungen auf und kann andere abmelden', async () => {
    const a = await loginAs('admin', ADMIN_PASSWORD)
    const b = await loginAs('admin', ADMIN_PASSWORD)
    const list = await call(sessions.GET, '/api/account/sessions', { cookie: a })
    expect(list.data.sessions.length).toBeGreaterThanOrEqual(2)
    expect(list.data.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1)
    await call(sessions.DELETE, '/api/account/sessions', { method: 'DELETE', cookie: a })
    expect((await call(me.GET, '/api/auth/me', { cookie: b })).status).toBe(401)
    expect((await call(me.GET, '/api/auth/me', { cookie: a })).status).toBe(200)
  })
})
