import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { migrations } from '@/lib/server/migrations'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-migrate-'))
afterAll(async () => {
  const { closeDb } = await import('@/lib/server/db')
  closeDb()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('Migrationen', () => {
  it('aktualisiert eine bestehende Datenbank (Version 1) ohne Datenverlust', async () => {
    // Datenbank im Zustand nach Migration 1 mit einer indizierten Notiz
    const old = new Database(path.join(dir, 'noted.db'))
    old.exec(migrations[0])
    old.pragma('user_version = 1')
    const t = Date.now()
    old
      .prepare(`INSERT INTO users (username, password_hash, role, created_at, updated_at) VALUES ('alt', 'x', 'admin', ?, ?)`)
      .run(t, t)
    const id = '11111111-1111-4111-8111-111111111111'
    old
      .prepare(`INSERT INTO notes (id, user_id, title, content, created_at, updated_at) VALUES (?, 1, 'Alt', 'Quantenmechanik', ?, ?)`)
      .run(id, t, t)
    old.prepare(`INSERT INTO notes_fts (note_id, user_id, title, content) VALUES (?, 1, 'Alt', 'Quantenmechanik')`).run(id)
    old.close()

    process.env.DATA_DIR = dir
    const { getDb } = await import('@/lib/server/db')
    const { searchNotes, updateNote } = await import('@/lib/server/notes')
    const db = getDb()
    expect(db.pragma('user_version', { simple: true })).toBe(migrations.length)
    expect(db.prepare('SELECT note_id FROM notes_fts_map').all()).toEqual([{ note_id: id }])
    expect(searchNotes(1, 'quanten').map((r) => r.id)).toEqual([id])

    // Nach einer Änderung gibt es weiterhin genau einen Indexeintrag
    updateNote(1, id, { content: 'Thermodynamik' })
    expect(searchNotes(1, 'quanten')).toEqual([])
    expect(searchNotes(1, 'thermo').map((r) => r.id)).toEqual([id])
    expect((db.prepare('SELECT COUNT(*) AS n FROM notes_fts').get() as { n: number }).n).toBe(1)
  })
})
