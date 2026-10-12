#!/usr/bin/env node
// Notfall-Werkzeug für Administratoren – direkt auf dem Server bzw. im Container ausführen.
//
//   node scripts/admin-cli.mjs list
//   node scripts/admin-cli.mjs reset-password <benutzer>   Neues Startpasswort, entsperren, abmelden
//   node scripts/admin-cli.mjs reset-mfa <benutzer>        Zwei-Faktor-Anmeldung zurücksetzen
//   node scripts/admin-cli.mjs make-admin <benutzer>       Benutzer zum Admin machen und aktivieren
//
// Docker: docker compose exec noted node scripts/admin-cli.mjs reset-mfa admin

import Database from 'better-sqlite3'
import { hash } from '@node-rs/argon2'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const dataDir = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'))
const dbPath = path.join(dataDir, 'noted.db')

function fail(msg) {
  console.error(`Fehler: ${msg}`)
  process.exit(1)
}

if (!fs.existsSync(dbPath)) fail(`Keine Datenbank unter ${dbPath} gefunden (DATA_DIR prüfen).`)

const db = new Database(dbPath)
db.pragma('foreign_keys = ON')
db.pragma('busy_timeout = 5000')

function generatePassword(length = 16) {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length]
  return out.match(/.{1,4}/g).join('-')
}

function findUser(name) {
  if (!name) fail('Bitte einen Benutzernamen angeben.')
  const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(name)
  if (!user) fail(`Benutzer „${name}“ nicht gefunden.`)
  return user
}

function audit(event, user) {
  db.prepare(
    `INSERT INTO audit_log (created_at, event, user_id, username, actor_username, details) VALUES (?, ?, ?, ?, 'cli', ?)`,
  ).run(Date.now(), event, user.id, user.username, JSON.stringify({ via: 'admin-cli' }))
}

const [command, arg] = process.argv.slice(2)
const now = Date.now()

switch (command) {
  case 'list': {
    const users = db
      .prepare('SELECT username, role, is_active, mfa_enabled, must_change_password, locked_until FROM users ORDER BY username')
      .all()
    for (const u of users) {
      const flags = [
        u.role === 'admin' ? 'admin' : 'user',
        u.is_active ? 'aktiv' : 'deaktiviert',
        u.mfa_enabled ? 'MFA' : 'ohne MFA',
        u.must_change_password ? 'Startpasswort' : null,
        u.locked_until && u.locked_until > now ? 'gesperrt' : null,
      ].filter(Boolean)
      console.log(`${u.username.padEnd(24)} ${flags.join(', ')}`)
    }
    break
  }
  case 'reset-password': {
    const user = findUser(arg)
    const password = generatePassword()
    const passwordHash = await hash(password, { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 })
    db.prepare(
      `UPDATE users SET password_hash = ?, must_change_password = 1, failed_logins = 0, mfa_failed = 0, locked_until = NULL,
         password_changed_at = ?, updated_at = ? WHERE id = ?`,
    ).run(passwordHash, now, now, user.id)
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id)
    audit('password_reset', user)
    console.log(`Neues Startpasswort für ${user.username}: ${password}`)
    console.log('Es muss bei der nächsten Anmeldung geändert werden.')
    break
  }
  case 'reset-mfa': {
    const user = findUser(arg)
    db.prepare(
      `UPDATE users SET mfa_enabled = 0, mfa_secret = NULL, mfa_pending_secret = NULL, mfa_pending_created_at = NULL,
         mfa_last_step = 0, failed_logins = 0, mfa_failed = 0, locked_until = NULL, updated_at = ? WHERE id = ?`,
    ).run(now, user.id)
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id)
    audit('mfa_reset', user)
    console.log(`Zwei-Faktor-Anmeldung für ${user.username} zurückgesetzt. Alle Sitzungen wurden beendet.`)
    break
  }
  case 'make-admin': {
    const user = findUser(arg)
    db.prepare(`UPDATE users SET role = 'admin', is_active = 1, updated_at = ? WHERE id = ?`).run(now, user.id)
    audit('user_updated', user)
    console.log(`${user.username} ist jetzt Administrator.`)
    break
  }
  default:
    console.log(`Verwendung:
  node scripts/admin-cli.mjs list
  node scripts/admin-cli.mjs reset-password <benutzer>
  node scripts/admin-cli.mjs reset-mfa <benutzer>
  node scripts/admin-cli.mjs make-admin <benutzer>`)
    process.exit(command ? 1 : 0)
}
db.close()
