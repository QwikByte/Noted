import 'server-only'
import { getDb } from '@/shared/server/db'

/** Stunde, zu der für das Konto ein neuer Lerntag beginnt – ohne Eintrag Mitternacht wie bisher */
export function getDayStartHour(userId: number): number {
  const row = getDb().prepare('SELECT day_start_hour FROM flashcard_settings WHERE user_id = ?').get(userId) as
    | { day_start_hour: number }
    | undefined
  return row?.day_start_hour ?? 0
}

export function setDayStartHour(userId: number, hour: number): number {
  getDb()
    .prepare(
      `INSERT INTO flashcard_settings (user_id, day_start_hour) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET day_start_hour = excluded.day_start_hour`,
    )
    .run(userId, hour)
  return getDayStartHour(userId)
}
