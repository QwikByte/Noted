#!/usr/bin/env node
// Notfall-Werkzeug für Administratoren – direkt auf dem Server bzw. im Container ausführen.
//
//   node scripts/admin-cli.mjs list
//   node scripts/admin-cli.mjs reset-password <benutzer>   Neues Startpasswort, entsperren, abmelden
//   node scripts/admin-cli.mjs reset-mfa <benutzer>        Zwei-Faktor-Anmeldung zurücksetzen
//   node scripts/admin-cli.mjs make-admin <benutzer>       Benutzer zum Admin machen und aktivieren
//   node scripts/admin-cli.mjs backup [bezeichnung]        Datenbank nach DATA_DIR/backups sichern (gibt den Pfad aus)
//   node scripts/admin-cli.mjs restore <datei>             Sicherung zurückspielen – nur bei gestoppter App!
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

const backupDir = path.join(dataDir, 'backups')
/** Anzahl der Sicherungen, die `backup` aufbewahrt (ältere werden gelöscht) */
const backupKeep = Math.max(1, Number(process.env.BACKUP_KEEP) || 10)

function openDb(file = dbPath) {
  if (!fs.existsSync(file)) fail(`Keine Datenbank unter ${file} gefunden (DATA_DIR prüfen).`)
  const conn = new Database(file, { fileMustExist: true })
  conn.pragma('foreign_keys = ON')
  conn.pragma('busy_timeout = 5000')
  return conn
}

let db = null

function generatePassword(length = 16) {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length]
  return out.match(/.{1,4}/g).join('-')
}

function findUser(name) {
  if (!name) fail('Bitte einen Benutzernamen angeben.')
  db ??= openDb()
  const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(name)
  if (!user) fail(`Benutzer „${name}“ nicht gefunden.`)
  return user
}

/** Konsistente Kopie der Datenbank (funktioniert auch bei laufender App) */
async function backupTo(label) {
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 })
  const stamp = new Date().toISOString().replace(/\.\d+Z$/, '').replace(/[:T]/g, '-')
  const safeLabel = String(label ?? '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40)
  const file = path.join(backupDir, `noted-${stamp}${safeLabel ? `-${safeLabel}` : ''}.db`)
  const conn = openDb()
  try {
    await conn.backup(`${file}.tmp`)
  } finally {
    conn.close()
  }
  fs.renameSync(`${file}.tmp`, file)
  return file
}

function pruneBackups() {
  const files = fs
    .readdirSync(backupDir)
    .filter((f) => /^noted-.+\.db$/.test(f))
    .sort()
  for (const f of files.slice(0, Math.max(0, files.length - backupKeep))) fs.rmSync(path.join(backupDir, f), { force: true })
}

function schemaVersion(file) {
  const conn = openDb(file)
  try {
    return {
      version: conn.pragma('user_version', { simple: true }),
      ok: conn.pragma('quick_check', { simple: true }) === 'ok',
      isNoted: !!conn.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'`).get(),
    }
  } finally {
    conn.close()
  }
}

function audit(event, user) {
  db.prepare(
    `INSERT INTO audit_log (created_at, event, user_id, username, actor_username, details) VALUES (?, ?, ?, ?, 'cli', ?)`,
  ).run(Date.now(), event, user.id, user.username, JSON.stringify({ via: 'admin-cli' }))
}

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const [command, arg] = args.filter((a) => !a.startsWith('--'))
const now = Date.now()

switch (command) {
  case 'list': {
    db = openDb()
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
  case 'backup': {
    if (!fs.existsSync(dbPath)) {
      console.error('Noch keine Datenbank vorhanden – nichts zu sichern.')
      break
    }
    const file = await backupTo(arg)
    pruneBackups()
    console.error(`Datenbank gesichert (die letzten ${backupKeep} Sicherungen bleiben erhalten):`)
    console.log(file)
    break
  }
  case 'restore': {
    // --if-schema-changed: nur zurückspielen, wenn eine neuere Version die Datenbank bereits migriert hat
    // (benutzt scripts/auto-update.sh beim Zurückrollen, damit keine Änderungen unnötig verloren gehen)
    if (!arg) fail('Bitte die Sicherungsdatei angeben.')
    const source = path.resolve(arg)
    if (!fs.existsSync(source)) fail(`Sicherung ${source} nicht gefunden.`)
    const backup = schemaVersion(source)
    if (!backup.ok || !backup.isNoted) fail('Die Sicherung ist beschädigt oder keine Noted-Datenbank.')
    if (fs.existsSync(dbPath)) {
      if (flags.has('--if-schema-changed') && schemaVersion(dbPath).version === backup.version) {
        console.log('Datenbankschema unverändert – Wiederherstellung nicht nötig.')
        break
      }
      const saved = await backupTo('vor-wiederherstellung')
      console.log(`Bisheriger Stand gesichert: ${saved}`)
    }
    fs.copyFileSync(source, `${dbPath}.restore`)
    for (const suffix of ['-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true })
    fs.renameSync(`${dbPath}.restore`, dbPath)
    console.log(`Datenbank aus ${path.basename(source)} wiederhergestellt.`)
    break
  }
  default:
    console.log(`Verwendung:
  node scripts/admin-cli.mjs list
  node scripts/admin-cli.mjs reset-password <benutzer>
  node scripts/admin-cli.mjs reset-mfa <benutzer>
  node scripts/admin-cli.mjs make-admin <benutzer>
  node scripts/admin-cli.mjs backup [bezeichnung]
  node scripts/admin-cli.mjs restore <datei>   (nur bei gestoppter App)`)
    process.exit(command ? 1 : 0)
}
db?.close()
