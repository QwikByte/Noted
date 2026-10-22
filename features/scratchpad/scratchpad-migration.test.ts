import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { migrations } from '@/shared/server/migrations'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-migrate-'))
afterAll(async () => {
  const { closeDb } = await import('@/shared/server/db')
  closeDb()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('Migration 24: Schmierzettel', () => {
  it('ergänzt die Tabelle in einer bestehenden Datenbank und löscht den Zettel mit dem Konto', async () => {
    const old = new Database(path.join(dir, 'noted.db'))
    old.pragma('foreign_keys = ON')
    for (const sql of migrations.slice(0, 23)) old.exec(sql)
    old.pragma('user_version = 23')
    const t = Date.now()
    old
      .prepare(`INSERT INTO users (username, password_hash, role, created_at, updated_at) VALUES ('alt', 'x', 'admin', ?, ?)`)
      .run(t, t)
    old.close()

    process.env.DATA_DIR = dir
    const { getDb } = await import('@/shared/server/db')
    const { getScratchpad, saveScratchpad } = await import('./server/scratchpad')
    const db = getDb()
    expect(db.pragma('user_version', { simple: true })).toBe(migrations.length)
    expect(getScratchpad(1)).toEqual({ content: '', version: 0, updatedAt: null })
    expect(saveScratchpad(1, { content: 'Raum 3.14', baseVersion: 0 })).toMatchObject({ content: 'Raum 3.14', version: 1 })

    db.prepare('DELETE FROM users').run()
    expect((db.prepare('SELECT COUNT(*) AS n FROM scratchpads').get() as { n: number }).n).toBe(0)
  })
})
