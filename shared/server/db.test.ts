import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { migrations } from './migrations'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-db-'))
afterAll(async () => {
  const { closeDb } = await import('./db')
  closeDb()
  fs.rmSync(dir, { recursive: true, force: true })
})

function memoryDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  for (const sql of migrations) db.exec(sql)
  return db
}

describe('Datenbank', () => {
  it('legt eine neue Datenbank mit dem aktuellen Schema an', async () => {
    process.env.DATA_DIR = dir
    const { getDb } = await import('./db')
    const db = getDb()
    expect(db.pragma('user_version', { simple: true })).toBe(migrations.length)
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(db.pragma('secure_delete', { simple: true })).toBe(1)
    expect(db.prepare("SELECT v FROM notes_fts_config WHERE k = 'secure-delete'").get()).toEqual({ v: 1 })
    expect(db.pragma('foreign_key_check')).toEqual([])
  })

  it('löscht mit einem Konto alle seine Daten – nur das Protokoll bleibt', () => {
    const db = memoryDb()
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND sql NOT LIKE 'CREATE VIRTUAL TABLE%'`)
      .pluck()
      .all() as string[]
    const owned = tables.filter((t) => db.prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name = 'user_id'`).get(t))
    expect(owned).toContain('notes')
    for (const table of owned) {
      const fk = db.prepare(`SELECT "table", on_delete FROM pragma_foreign_key_list(?) WHERE "from" = 'user_id'`).get(table)
      expect(fk, table).toEqual(table === 'audit_log' ? undefined : { table: 'users', on_delete: 'CASCADE' })
    }
    db.close()
  })

  it('begrenzt Kartenarten und -seiten und behält Bewertungen gelöschter Karten im Protokoll', () => {
    const db = memoryDb()
    db.exec(`
      INSERT INTO users (id, username, password_hash, created_at, updated_at) VALUES (1, 'a', 'x', 0, 0);
      INSERT INTO decks (id, user_id, name, created_at, updated_at) VALUES ('d', 1, 'Stapel', 0, 0);
      INSERT INTO cards (id, user_id, deck_id, type, front, created_at, updated_at) VALUES ('z', 1, 'd', 'cloze', '==a==', 0, 0);
      INSERT INTO card_reviews (card_id, side, user_id, phase, ease, due, reviewed_at, introduced_at)
        VALUES ('z', 49, 1, 'review', 2.5, 5, 4, 3);
      INSERT INTO review_log (user_id, card_id, deck_id, side, rating, phase, interval_before, interval_after, duration_ms, reviewed_at)
        VALUES (1, 'z', 'd', 49, 3, 'new', 0, 1, 100, 7);
    `)
    expect(() =>
      db.exec(`INSERT INTO cards (id, user_id, deck_id, type, front, created_at, updated_at) VALUES ('x', 1, 'd', 'foo', 'x', 0, 0)`),
    ).toThrow()
    expect(() =>
      db.exec(
        `INSERT INTO card_reviews (card_id, side, user_id, phase, ease, due, reviewed_at, introduced_at)
         VALUES ('z', 50, 1, 'review', 2.5, 5, 4, 3)`,
      ),
    ).toThrow()

    db.exec(`DELETE FROM cards WHERE id = 'z'`)
    expect(db.prepare('SELECT COUNT(*) FROM card_reviews').pluck().get()).toBe(0)
    expect(db.prepare('SELECT COUNT(*) FROM review_log').pluck().get()).toBe(1)
    db.close()
  })

  it('Bereiche in PDFs (Migration 3): vorhandene Anmerkungen sind Textmarkierungen, andere Arten gibt es nicht', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.exec(migrations[0])
    db.exec(migrations[1])
    db.exec(`
      INSERT INTO users (id, username, password_hash, created_at, updated_at) VALUES (1, 'a', 'x', 0, 0);
      INSERT INTO attachments (id, user_id, filename, mime, size, created_at) VALUES ('f', 1, 'Skript.pdf', 'application/pdf', 1, 0);
      INSERT INTO pdf_annotations (id, user_id, attachment_id, page, rects, quote, created_at, updated_at)
        VALUES ('alt', 1, 'f', 1, '[[0,0,1,1]]', 'Zitat', 0, 0);
    `)
    db.exec(migrations[2])
    expect(db.prepare("SELECT kind FROM pdf_annotations WHERE id = 'alt'").pluck().get()).toBe('text')
    const insert = (kind: string) =>
      db
        .prepare(
          `INSERT INTO pdf_annotations (id, user_id, attachment_id, kind, page, rects, quote, created_at, updated_at)
           VALUES (?, 1, 'f', ?, 1, '[[0,0,1,1]]', '', 0, 0)`,
        )
        .run(kind, kind)
    expect(() => insert('area')).not.toThrow()
    expect(() => insert('kreis')).toThrow(/CHECK constraint/)
    db.close()
  })

  it('Links mit Ordnerpfad (Migration 2): vorhandene Links bleiben, ihr Ordner wird beim Start nachgetragen', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.exec(migrations[0])
    db.exec(`
      INSERT INTO users (id, username, password_hash, created_at, updated_at) VALUES (1, 'a', 'x', 0, 0);
      INSERT INTO notes (id, user_id, title, content, created_at, updated_at) VALUES ('n', 1, 'Plan', '[[Analysis/Übung 1]]', 0, 0);
      INSERT INTO note_links (note_id, target) VALUES ('n', 'übung 1');
    `)
    db.exec(migrations[1])
    expect(db.prepare('SELECT note_id, target, path FROM note_links').all()).toEqual([{ note_id: 'n', target: 'übung 1', path: '' }])
    expect(db.prepare("SELECT value FROM settings WHERE key = 'reindex_link_paths'").pluck().get()).toBe('1')
    // Derselbe Titel mit verschiedenen Ordnern in einer Notiz
    db.exec(`INSERT INTO note_links (note_id, target, path) VALUES ('n', 'übung 1', 'analysis')`)
    db.exec(`DELETE FROM notes WHERE id = 'n'`)
    expect(db.prepare('SELECT COUNT(*) FROM note_links').pluck().get()).toBe(0)
    db.close()
  })
})
