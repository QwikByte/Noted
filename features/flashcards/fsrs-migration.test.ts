import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrations } from '@/shared/server/migrations'

describe('Migration 23: eigene FSRS-Parameter', () => {
  it('speichert einen Parametersatz je Konto und löscht ihn mit dem Konto', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    for (const m of migrations.slice(0, 22)) db.exec(m)
    db.exec(`
      INSERT INTO users (id, username, password_hash, created_at, updated_at) VALUES (1, 'a', 'x', 0, 0);
      INSERT INTO users (id, username, password_hash, created_at, updated_at) VALUES (2, 'b', 'x', 0, 0);
    `)
    db.exec(migrations[22])
    const insert = db.prepare(
      `INSERT INTO fsrs_params (user_id, weights, reviews, log_loss, rmse, default_log_loss, default_rmse, optimized_at)
       VALUES (?, '[1]', 100, 0.3, 0.02, 0.32, 0.03, 5)`,
    )
    insert.run(1)
    insert.run(2)
    expect(() => insert.run(1)).toThrow()
    db.exec('DELETE FROM users WHERE id = 1')
    expect(db.prepare('SELECT user_id FROM fsrs_params').all()).toEqual([{ user_id: 2 }])
    expect(db.pragma('foreign_key_check')).toEqual([])
    db.close()
  })
})
