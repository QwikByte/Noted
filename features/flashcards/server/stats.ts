import 'server-only'
import { getDb } from '@/shared/server/db'
import { badRequest } from '@/shared/server/http'
import { DAY } from '../srs'
import { aggregateLog, type LogRow } from '../stats'
import { getDayStartHour } from './settings'
import type { StudyStats } from '../types'

/** Jahresüberblick: 53 Wochen und ein paar Tage Puffer für die Zeitzone */
const HISTORY_DAYS = 380

/** Zeitpunkt → Lerntag (YYYY-MM-DD) in der Zeitzone des Geräts; je Viertelstunde einmal gerechnet – Zonen weichen um
 *  Vielfache von 15 Minuten von UTC ab, innerhalb einer Viertelstunde ändert sich der Tag also nie. Beginnt der Lerntag
 *  später als um Mitternacht (`dayStartHour`), zählt die Zeit davor zum Vortag. */
export function dayFormatter(timeZone: string, dayStartHour = 0): (t: number) => string {
  let fmt: Intl.DateTimeFormat
  try {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  } catch {
    throw badRequest('Unbekannte Zeitzone.')
  }
  const cache = new Map<number, string>()
  const shift = dayStartHour * 3_600_000
  return (t) => {
    const slot = Math.floor((t - shift) / 900_000)
    let day = cache.get(slot)
    if (day === undefined) {
      const parts = Object.fromEntries(fmt.formatToParts(new Date(slot * 900_000)).map((p) => [p.type, p.value]))
      day = `${parts.year}-${parts.month}-${parts.day}`
      cache.set(slot, day)
    }
    return day
  }
}

/** Lernstatistik aus dem Bewertungsprotokoll – Lerntage in der Zeitzone des Geräts, ab dem Tagesbeginn des Kontos */
export function getStudyStats(userId: number, timeZone: string, now = Date.now()): StudyStats {
  const dayOf = dayFormatter(timeZone, getDayStartHour(userId))
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT reviewed_at AS reviewedAt, rating, phase, deck_id AS deckId, duration_ms AS durationMs
       FROM review_log WHERE user_id = ? AND reviewed_at >= ?`,
    )
    .all(userId, now - HISTORY_DAYS * DAY) as LogRow[]
  const { days, decks } = aggregateLog(rows, dayOf, now - 30 * DAY)
  const { total, since } = db
    .prepare('SELECT COUNT(*) AS total, MIN(reviewed_at) AS since FROM review_log WHERE user_id = ?')
    .get(userId) as { total: number; since: number | null }
  return { days, decks, total, since }
}

/**
 * Kartenseiten, die heute (in der Zeitzone des Geräts) mit „Nochmal“ bewertet wurden – für die Übung „Heute vergessen“.
 * Ein Tag hat in keiner Zeitzone mehr als 26 Stunden; was früher war, kann nicht von heute sein.
 */
export function againToday(userId: number, timeZone: string, now = Date.now()): { cardId: string; side: number }[] {
  const dayOf = dayFormatter(timeZone, getDayStartHour(userId))
  const today = dayOf(now)
  const rows = getDb()
    .prepare(
      `SELECT card_id AS cardId, side, reviewed_at AS reviewedAt FROM review_log
       WHERE user_id = ? AND rating = 1 AND reviewed_at >= ? AND reviewed_at <= ?`,
    )
    .all(userId, now - 26 * 3_600_000, now) as { cardId: string; side: number; reviewedAt: number }[]
  const sides = new Map<string, { cardId: string; side: number }>()
  for (const { cardId, side, reviewedAt } of rows) {
    if (dayOf(reviewedAt) === today) sides.set(`${cardId}:${side}`, { cardId, side })
  }
  return [...sides.values()]
}

const RATING_LABELS = ['', 'Nochmal', 'Schwer', 'Gut', 'Einfach']
const PHASE_LABELS: Record<string, string> = { new: 'neu', learning: 'lernend', review: 'wiederholt', relearning: 'neu lernend' }

/** Feld für CSV (Semikolon, für Excel und LibreOffice auf Deutsch) – Formeln am Anfang werden entschärft */
function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

const decimal = (n: number) => (Math.round(n * 100) / 100).toString().replace('.', ',')

/** Ganzes Bewertungsprotokoll als CSV – Zeitpunkt in UTC (ISO 8601), Karte als erste Zeile der Vorderseite */
export function reviewLogCsv(userId: number): string {
  const rows = getDb()
    .prepare(
      `SELECT l.reviewed_at, l.rating, l.phase, l.side, l.interval_before, l.interval_after, l.duration_ms,
              d.name AS deck, c.front, c.type
       FROM review_log l
       LEFT JOIN decks d ON d.id = l.deck_id AND d.user_id = l.user_id
       LEFT JOIN cards c ON c.id = l.card_id AND c.user_id = l.user_id
       WHERE l.user_id = ? ORDER BY l.reviewed_at`,
    )
    .all(userId) as {
    reviewed_at: number
    rating: number
    phase: string
    side: number
    interval_before: number
    interval_after: number
    duration_ms: number
    deck: string | null
    front: string | null
    type: string | null
  }[]
  const header = ['Zeitpunkt', 'Stapel', 'Karte', 'Seite', 'Bewertung', 'Phase', 'Abstand vorher (Tage)', 'Abstand nachher (Tage)', 'Dauer (s)']
  const lines = rows.map((r) =>
    [
      new Date(r.reviewed_at).toISOString(),
      r.deck ?? '(gelöscht)',
      (r.front ?? '(gelöscht)').split('\n')[0].slice(0, 200),
      r.type === 'cloze'
        ? `Lücke ${r.side + 1}`
        : r.type === 'occlusion'
          ? `Fläche ${r.side + 1}`
          : r.side === 1
            ? 'Rückseite'
            : 'Vorderseite',
      RATING_LABELS[r.rating] ?? String(r.rating),
      PHASE_LABELS[r.phase] ?? r.phase,
      decimal(r.interval_before),
      decimal(r.interval_after),
      decimal(r.duration_ms / 1000),
    ]
      .map(csvField)
      .join(';'),
  )
  // BOM, damit Excel die Umlaute richtig liest
  return '﻿' + [header.join(';'), ...lines].join('\r\n') + '\r\n'
}
