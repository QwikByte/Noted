import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrations } from '@/shared/server/migrations'

describe('Migration 18: Übungen entfernt', () => {
  it('löscht Fächer, Blätter, Aufgaben und die Abgabe-Termine, andere Termine bleiben', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    for (const m of migrations.slice(0, 17)) db.exec(m)
    db.exec(`
      INSERT INTO users (id, username, password_hash, created_at, updated_at) VALUES (1, 'alt', 'x', 0, 0);
      INSERT INTO events (id, user_id, title, start_at, end_at, created_at, updated_at) VALUES
        ('abgabe', 1, 'Abgabe Blatt 1 – Analysis I', '2026-10-20T12:00', '2026-10-20T12:00', 0, 0),
        ('klausur', 1, 'Analysis I', '2026-10-30T10:00', '2026-10-30T12:00', 0, 0);
      INSERT INTO decks (id, user_id, name, created_at, updated_at) VALUES ('d', 1, 'Analysis', 0, 0);
      INSERT INTO exam_decks (event_id, deck_id) VALUES ('klausur', 'd');
      INSERT INTO courses (id, user_id, name, created_at, updated_at) VALUES ('c', 1, 'Analysis I', 0, 0);
      INSERT INTO exercise_sheets (id, user_id, course_id, title, max_points, event_id, created_at, updated_at) VALUES
        ('s1', 1, 'c', 'Blatt 1', 20, 'abgabe', 0, 0),
        ('s2', 1, 'c', 'Blatt 2', 20, NULL, 0, 0);
      INSERT INTO course_tasks (id, user_id, course_id, title, created_at, updated_at) VALUES ('t', 1, 'c', 'Aufgabe 1', 0, 0);
    `)
    db.exec(migrations[17])

    expect(db.prepare('SELECT id FROM events').all()).toEqual([{ id: 'klausur' }])
    expect(db.prepare('SELECT event_id, deck_id FROM exam_decks').all()).toEqual([{ event_id: 'klausur', deck_id: 'd' }])
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE name IN ('courses', 'exercise_sheets', 'course_tasks')`)
    expect(tables.all()).toEqual([])
    expect(db.pragma('foreign_key_check')).toEqual([])
    db.close()
  })
})
