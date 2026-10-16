import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { migrations } from '@/shared/server/migrations'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-migrate-format-'))
afterAll(async () => {
  const { closeDb } = await import('@/shared/server/db')
  closeDb()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('Migration 5: Formate Mindmap und Canvas', () => {
  it('behält Format, Tags und Links bestehender Notizen und erlaubt die neuen Formate', async () => {
    // Datenbank im Zustand nach Migration 4 mit einer Notiz in formatiertem Text samt Tag und Link
    const old = new Database(path.join(dir, 'noted.db'))
    old.pragma('foreign_keys = ON')
    for (const m of migrations.slice(0, 4)) old.exec(m)
    old.pragma('user_version = 4')
    const t = Date.now()
    old
      .prepare(`INSERT INTO users (username, password_hash, role, created_at, updated_at) VALUES ('alt', 'x', 'admin', ?, ?)`)
      .run(t, t)
    const id = '22222222-2222-4222-8222-222222222222'
    old
      .prepare(`INSERT INTO notes (id, user_id, title, content, format, created_at, updated_at) VALUES (?, 1, 'Alt', '<p>x</p>', 'richtext', ?, ?)`)
      .run(id, t, t)
    old.prepare(`INSERT INTO note_tags (note_id, tag) VALUES (?, 'physik')`).run(id)
    old.prepare(`INSERT INTO note_links (note_id, target) VALUES (?, 'optik')`).run(id)
    old.close()

    process.env.DATA_DIR = dir
    const { getDb } = await import('@/shared/server/db')
    const { createNote, getNote } = await import('./server/notes')
    const db = getDb()
    expect(db.pragma('user_version', { simple: true })).toBe(migrations.length)
    expect(getNote(1, id)).toMatchObject({ format: 'richtext', content: '<p>x</p>', tags: ['physik'] })
    expect(db.prepare('SELECT target FROM note_links WHERE note_id = ?').all(id)).toEqual([{ target: 'optik' }])
    expect(createNote(1, { title: 'Karte', folderId: null, content: '', format: 'mindmap' }).format).toBe('mindmap')
    expect(createNote(1, { title: 'Fläche', folderId: null, content: '', format: 'canvas' }).format).toBe('canvas')
    expect(() => db.prepare(`UPDATE notes SET format = 'docx' WHERE id = ?`).run(id)).toThrow(/CHECK/)
  })
})
