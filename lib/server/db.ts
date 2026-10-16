import 'server-only'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import { getConfig } from './config'
import { migrations } from './migrations'
import { bootstrapAdmin } from './bootstrap'

type DB = Database.Database

const globalForDb = globalThis as unknown as { __notedDb?: DB; __notedDbPath?: string }

function migrate(db: DB) {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let i = current; i < migrations.length; i++) {
    db.transaction(() => {
      db.exec(migrations[i])
      db.pragma(`user_version = ${i + 1}`)
    })()
  }
}

/** Liefert die (einmalig geöffnete) SQLite-Verbindung. */
export function getDb(): DB {
  const { dbPath, dataDir } = getConfig()
  if (globalForDb.__notedDb && globalForDb.__notedDbPath === dbPath) return globalForDb.__notedDb

  fs.mkdirSync(dataDir, { recursive: true })
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  migrate(db)

  globalForDb.__notedDb = db
  globalForDb.__notedDbPath = dbPath
  bootstrapAdmin(db)
  return db
}

/** Nur für Tests: Verbindung schließen, damit eine neue Datenbank geöffnet werden kann. */
export function closeDb() {
  globalForDb.__notedDb?.close()
  globalForDb.__notedDb = undefined
  globalForDb.__notedDbPath = undefined
}
