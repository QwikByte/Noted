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

describe('Migration 25: Tresor', () => {
  it('lässt bestehende Notizen außerhalb des Tresors durchsuchbar und schaltet FTS5 secure-delete ein', async () => {
    const old = new Database(path.join(dir, 'noted.db'))
    old.pragma('foreign_keys = ON')
    for (const sql of migrations.slice(0, 24)) old.exec(sql)
    old.pragma('user_version = 24')
    const t = Date.now()
    old
      .prepare(
        `INSERT INTO users (username, password_hash, role, created_at, updated_at) VALUES ('alt', 'x', 'admin', ?, ?)`,
      )
      .run(t, t)
    const noteId = '33333333-3333-4333-8333-333333333333'
    old
      .prepare(
        `INSERT INTO notes (id, user_id, title, content, created_at, updated_at) VALUES (?, 1, 'Bestand', ?, ?, ?)`,
      )
      .run(noteId, 'Eigenwerte der Matrix', t, t)
    const fts = old
      .prepare(
        `INSERT INTO notes_fts (note_id, user_id, title, content) VALUES (?, 1, 'Bestand', 'Eigenwerte der Matrix')`,
      )
      .run(noteId)
    old.prepare('INSERT INTO notes_fts_map (note_id, fts_rowid) VALUES (?, ?)').run(noteId, fts.lastInsertRowid)
    old.close()

    process.env.DATA_DIR = dir
    const { getDb } = await import('@/shared/server/db')
    const { listFolders, listNotes, searchNotes, trashNote } = await import('@/features/notes/server/notes')
    const db = getDb()
    expect(db.pragma('user_version', { simple: true })).toBe(migrations.length)
    expect(db.pragma('secure_delete', { simple: true })).toBe(1)
    const config = db.prepare("SELECT v FROM notes_fts_config WHERE k = 'secure-delete'").get() as { v: number }
    expect(config.v).toBe(1)

    expect(listNotes(1)).toEqual([expect.objectContaining({ title: 'Bestand', vault: false, titleEnc: null })])
    expect(listFolders(1)).toEqual([])
    expect(searchNotes(1, 'eigenw').map((n) => n.title)).toEqual(['Bestand'])
    // Löschen aus dem Index geht mit secure-delete weiter
    trashNote(1, '33333333-3333-4333-8333-333333333333')
    expect(searchNotes(1, 'eigenw')).toEqual([])
  })
})
