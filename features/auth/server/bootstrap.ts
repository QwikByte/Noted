import 'server-only'
import type Database from 'better-sqlite3'
import { hashPasswordSync } from './password'
import { generatePassword } from '@/shared/server/crypto'

/**
 * Legt beim allerersten Start einen Admin an.
 * Benutzername/Passwort kommen aus ADMIN_USERNAME / ADMIN_PASSWORD.
 * Ohne ADMIN_PASSWORD wird ein zufälliges Passwort erzeugt und einmalig im Log ausgegeben;
 * es muss bei der ersten Anmeldung geändert werden.
 */
export function bootstrapAdmin(db: Database.Database) {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n
  if (count > 0) return

  const username = (process.env.ADMIN_USERNAME || 'admin').trim()
  const envPassword = process.env.ADMIN_PASSWORD
  const password = envPassword && envPassword.length >= 10 ? envPassword : generatePassword()
  const generated = password !== envPassword
  const ts = Date.now()

  db.prepare(
    `INSERT INTO users (username, display_name, password_hash, role, must_change_password, created_at, updated_at, password_changed_at)
     VALUES (?, ?, ?, 'admin', ?, ?, ?, ?)`,
  ).run(username, 'Administrator', hashPasswordSync(password), generated ? 1 : 0, ts, ts, ts)

  if (envPassword && envPassword.length < 10) {
    console.warn('[noted] ADMIN_PASSWORD ist kürzer als 10 Zeichen und wurde ignoriert.')
  }
  if (process.env.NODE_ENV !== 'test') {
    const line = '='.repeat(64)
    console.log(`\n${line}\n  Noted: Admin-Konto angelegt\n  Benutzername: ${username}`)
    if (generated) console.log(`  Passwort:     ${password}\n  (muss bei der ersten Anmeldung geändert werden)`)
    else console.log('  Passwort:     aus ADMIN_PASSWORD')
    console.log(`${line}\n`)
  }
}
