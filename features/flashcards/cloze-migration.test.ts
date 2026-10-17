import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrations } from '@/shared/server/migrations'

describe('Migration 12: Lückentext-Karten', () => {
  it('behält Karten, Lernstand und Protokoll und erlaubt Lücken als Kartenseiten', () => {
    // Datenbank im Zustand nach Migration 11 mit einer beidseitigen, ausgesetzten Karte samt Lernstand und Protokoll
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    for (const m of migrations.slice(0, 11)) db.exec(m)
    db.exec(`
      INSERT INTO users (id, username, password_hash, created_at, updated_at) VALUES (1, 'alt', 'x', 0, 0);
      INSERT INTO decks (id, user_id, name, created_at, updated_at) VALUES ('d', 1, 'Stapel', 0, 0);
      INSERT INTO cards (id, user_id, deck_id, type, front, back, created_at, updated_at, suspended)
        VALUES ('c', 1, 'd', 'reversed', 'Haus', 'house', 0, 0, 1);
      INSERT INTO card_reviews (card_id, side, user_id, phase, ease, lapses, due, reviewed_at, introduced_at)
        VALUES ('c', 1, 1, 'review', 2.5, 2, 5, 4, 3);
      INSERT INTO review_log (user_id, card_id, deck_id, side, rating, phase, interval_before, interval_after, duration_ms, reviewed_at)
        VALUES (1, 'c', 'd', 1, 3, 'new', 0, 1, 100, 7);
    `)
    for (const m of migrations.slice(11, 12)) db.exec(m)

    expect(db.prepare('SELECT type, suspended, front FROM cards').get()).toEqual({ type: 'reversed', suspended: 1, front: 'Haus' })
    expect(db.prepare('SELECT card_id, side, lapses, due FROM card_reviews').all()).toEqual([{ card_id: 'c', side: 1, lapses: 2, due: 5 }])
    expect(db.prepare('SELECT card_id, side, rating, reviewed_at FROM review_log').all()).toEqual([
      { card_id: 'c', side: 1, rating: 3, reviewed_at: 7 },
    ])

    // Neue Kartenart und Lernstand je Lücke; Grenzen und Fremdschlüssel greifen weiter
    db.exec(`
      INSERT INTO cards (id, user_id, deck_id, type, front, created_at, updated_at) VALUES ('z', 1, 'd', 'cloze', '==a==', 0, 0);
      INSERT INTO card_reviews (card_id, side, user_id, phase, ease, due, reviewed_at, introduced_at) VALUES ('z', 7, 1, 'review', 2.5, 5, 4, 3);
    `)
    expect(() => db.exec(`INSERT INTO cards (id, user_id, deck_id, type, front, created_at, updated_at) VALUES ('x', 1, 'd', 'foo', 'x', 0, 0)`)).toThrow()
    expect(() =>
      db.exec(`INSERT INTO card_reviews (card_id, side, user_id, phase, ease, due, reviewed_at, introduced_at) VALUES ('z', 50, 1, 'review', 2.5, 5, 4, 3)`),
    ).toThrow()
    db.exec(`DELETE FROM cards WHERE id = 'c'`)
    expect(db.prepare('SELECT card_id, side FROM card_reviews').all()).toEqual([{ card_id: 'z', side: 7 }])
    // Das Protokoll bleibt beim Löschen der Karte
    expect(db.prepare('SELECT COUNT(*) AS n FROM review_log').get()).toEqual({ n: 1 })
    expect(db.pragma('foreign_key_check')).toEqual([])
    db.close()
  })
})
