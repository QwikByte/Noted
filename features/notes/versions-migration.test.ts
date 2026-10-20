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

describe('Migration Versionsverlauf', () => {
  it('ergänzt den Verlauf in einer bestehenden Datenbank (Version 18) ohne Datenverlust', async () => {
    const old = new Database(path.join(dir, 'noted.db'))
    old.pragma('foreign_keys = ON')
    for (const sql of migrations.slice(0, 18)) old.exec(sql)
    old.pragma('user_version = 18')
    const t = Date.now() - 86_400_000
    old
      .prepare(`INSERT INTO users (username, password_hash, role, created_at, updated_at) VALUES ('alt', 'x', 'admin', ?, ?)`)
      .run(t, t)
    const id = '22222222-2222-4222-8222-222222222222'
    old
      .prepare(`INSERT INTO notes (id, user_id, title, content, created_at, updated_at) VALUES (?, 1, 'Alt', 'Erster Stand', ?, ?)`)
      .run(id, t, t)
    old.close()

    process.env.DATA_DIR = dir
    const { getDb } = await import('@/shared/server/db')
    const { getNote, updateNote } = await import('./server/notes')
    const { listVersions, getVersion } = await import('./server/versions')
    const db = getDb()
    expect(db.pragma('user_version', { simple: true })).toBe(migrations.length)
    expect(getNote(1, id).content).toBe('Erster Stand')
    expect(listVersions(1, id)).toEqual([])

    // Die Notiz ist älter als 10 Minuten: Die erste Änderung sichert den bisherigen Stand
    updateNote(1, id, { content: 'Zweiter Stand' })
    const [v] = listVersions(1, id)
    expect(v).toMatchObject({ reason: 'edit', version: 1, title: 'Alt', format: 'markdown' })
    expect(getVersion(1, id, v.id).content).toBe('Erster Stand')

    // Benutzer löschen entfernt auch den Verlauf
    db.prepare('DELETE FROM users WHERE id = 1').run()
    expect((db.prepare('SELECT COUNT(*) AS n FROM note_versions').get() as { n: number }).n).toBe(0)
  })
})
