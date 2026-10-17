import 'server-only'
import { z } from 'zod'
import { getDb } from '@/shared/server/db'
import { cleanSubject } from '../sessions'
import { MAX_GOAL, MAX_SESSION_MS, MAX_SUBJECT } from '../limits'
import type { FocusSession, FocusSessionData } from '../types'

/** So weit zurück liefert die Übersicht Runden (Wochen der Lernstatistik plus Puffer) */
const HISTORY_MS = 120 * 86_400_000

type SessionRow = { id: string; subject: string; goal: string; started_at: number; duration_ms: number }

const toSession = (r: SessionRow): FocusSession => ({
  id: r.id,
  subject: r.subject,
  goal: r.goal,
  startedAt: r.started_at,
  durationMs: r.duration_ms,
})

/** Gezählte Runden übernehmen (auch offline gesammelte) – eine schon bekannte ID zählt nicht noch einmal */
export function saveFocusSessions(userId: number, sessions: FocusSession[]): { saved: number } {
  const db = getDb()
  const insert = db.prepare(
    `INSERT OR IGNORE INTO focus_sessions (id, user_id, subject, goal, started_at, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  let saved = 0
  db.transaction(() => {
    const t = Date.now()
    for (const s of sessions) {
      saved += insert.run(s.id, userId, cleanSubject(s.subject), s.goal.trim(), s.startedAt, s.durationMs, t).changes
    }
  })()
  return { saved }
}

/** Runden der letzten Monate und die zuletzt benutzten Fächer */
export function listFocusSessions(userId: number, now = Date.now()): FocusSessionData {
  const db = getDb()
  const sessions = (
    db
      .prepare('SELECT * FROM focus_sessions WHERE user_id = ? AND started_at >= ? ORDER BY started_at')
      .all(userId, now - HISTORY_MS) as SessionRow[]
  ).map(toSession)
  const subjects = (
    db
      .prepare(
        `SELECT subject FROM focus_sessions WHERE user_id = ? AND subject != ''
         GROUP BY subject COLLATE NOCASE ORDER BY MAX(started_at) DESC LIMIT 30`,
      )
      .all(userId) as { subject: string }[]
  ).map((r) => r.subject)
  return { sessions, subjects }
}

const time = z.number().int().min(0).max(8_640_000_000_000_000)

export const focusSessionSchema = z.object({
  id: z.string().uuid(),
  subject: z.string().max(MAX_SUBJECT),
  goal: z.string().max(MAX_GOAL),
  startedAt: time,
  durationMs: z.number().int().min(1000).max(MAX_SESSION_MS),
})
