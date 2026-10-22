import 'server-only'
import { getDb } from '@/shared/server/db'
import { conflict } from '@/shared/server/http'
import type { Scratchpad } from '../types'

type Row = { content: string; version: number; updated_at: number }

const EMPTY: Scratchpad = { content: '', version: 0, updatedAt: null }

export function getScratchpad(userId: number): Scratchpad {
  const row = getDb().prepare('SELECT content, version, updated_at FROM scratchpads WHERE user_id = ?').get(userId) as
    | Row
    | undefined
  return row ? { content: row.content, version: row.version, updatedAt: row.updated_at } : EMPTY
}

/**
 * Zettel speichern, sofern er auf dem aktuellen Stand beruht (`baseVersion`) – sonst 409 mit dem Serverstand, den der
 * Browser zusammenführt. Derselbe Inhalt noch einmal (wiederholtes Senden) ändert nichts.
 */
export function saveScratchpad(userId: number, input: { content: string; baseVersion: number }): Scratchpad {
  const db = getDb()
  return db.transaction(() => {
    const current = getScratchpad(userId)
    if (input.baseVersion !== current.version) {
      throw conflict('Der Schmierzettel wurde inzwischen auf einem anderen Gerät geändert.', 'version_conflict', {
        scratchpad: current,
      })
    }
    if (input.content === current.content) return current
    const t = Date.now()
    db.prepare(
      `INSERT INTO scratchpads (user_id, content, version, updated_at) VALUES (?, ?, 1, ?)
       ON CONFLICT(user_id) DO UPDATE SET content = excluded.content, version = version + 1, updated_at = excluded.updated_at`,
    ).run(userId, input.content, t)
    return getScratchpad(userId)
  })()
}
