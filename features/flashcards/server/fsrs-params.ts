import 'server-only'
import { getDb } from '@/shared/server/db'
import { ApiError } from '@/shared/server/http'
import { rateLimit } from '@/shared/server/rate-limit'
import { daysBetween } from '@/features/calendar/dates'
import { DEFAULT_WEIGHTS, clipWeights } from '../fsrs'
import { buildSequences, evaluationData } from '../fsrs-dataset'
import { evaluateWeights, optimizeFsrs } from '../fsrs-optimizer'
import { dayFormatter } from './stats'
import { getDayStartHour } from './settings'
import type { FsrsOptimizeResult, FsrsParams, ReviewLogEntry } from '../types'

/** Höchstens so viele (die neuesten) Bewertungen fließen in eine Optimierung ein */
const MAX_OPTIMIZE_REVIEWS = 200_000

type Row = {
  weights: string
  reviews: number
  log_loss: number
  rmse: number
  default_log_loss: number
  default_rmse: number
  optimized_at: number
}

// Eine Optimierung je Prozess – sie gibt zwar zwischendurch ab, rechnet aber viel
const lock = globalThis as unknown as { __notedFsrsRunning?: boolean }

/** Eigene FSRS-Gewichte des Kontos – `null`: Standardwerte (auch bei einem beschädigten Eintrag) */
export function getFsrsParams(userId: number): FsrsParams | null {
  const row = getDb().prepare('SELECT * FROM fsrs_params WHERE user_id = ?').get(userId) as Row | undefined
  if (!row) return null
  let weights: unknown
  try {
    weights = JSON.parse(row.weights)
  } catch {
    weights = null
  }
  if (!Array.isArray(weights) || weights.length !== DEFAULT_WEIGHTS.length || !weights.every(Number.isFinite)) {
    console.error('[noted] Ungültige FSRS-Parameter, es gelten die Standardwerte', userId)
    return null
  }
  return {
    weights: clipWeights(weights as number[]),
    reviews: row.reviews,
    metrics: { logLoss: row.log_loss, rmse: row.rmse },
    defaultMetrics: { logLoss: row.default_log_loss, rmse: row.default_rmse },
    optimizedAt: row.optimized_at,
  }
}

/**
 * Gewichte aus dem Bewertungsprotokoll schätzen – gespeichert nur, wenn sie die Wiederholungen besser vorhersagen
 * (RMSE) als die bisher gültigen. Tage zählen in der Zeitzone des Geräts, ab dem Tagesbeginn des Kontos.
 */
export async function optimizeFsrsParams(userId: number, timeZone: string): Promise<FsrsOptimizeResult> {
  if (!rateLimit(`fsrs:${userId}`, 10, 60 * 60_000).ok) {
    throw new ApiError(429, 'rate_limited', 'Zu viele Optimierungen. Bitte versuche es später noch einmal.')
  }
  if (lock.__notedFsrsRunning) {
    throw new ApiError(409, 'busy', 'Gerade läuft schon eine Optimierung. Bitte versuche es gleich noch einmal.')
  }
  lock.__notedFsrsRunning = true
  try {
    const day = dayFormatter(timeZone, getDayStartHour(userId))
    const dayOf = (t: number) => daysBetween('1970-01-01', day(t))
    const db = getDb()
    const cutoff = db
      .prepare('SELECT reviewed_at FROM review_log WHERE user_id = ? ORDER BY reviewed_at DESC LIMIT 1 OFFSET ?')
      .get(userId, MAX_OPTIMIZE_REVIEWS - 1) as { reviewed_at: number } | undefined
    const rows = db
      .prepare(
        `SELECT card_id AS cardId, side, rating, phase, reviewed_at AS reviewedAt FROM review_log
         WHERE user_id = ? AND reviewed_at >= ? ORDER BY card_id, side, reviewed_at`,
      )
      .all(userId, cutoff?.reviewed_at ?? 0) as Pick<ReviewLogEntry, 'cardId' | 'side' | 'rating' | 'phase' | 'reviewedAt'>[]
    const sequences = buildSequences(rows, dayOf)
    const outcome = await optimizeFsrs(sequences, { pause: () => new Promise((resolve) => setImmediate(resolve)) })
    const current = getFsrsParams(userId)
    if (outcome.status === 'not_enough') {
      return { status: 'not_enough', reviews: outcome.reviews, before: null, after: null, fsrs: current }
    }
    const data = evaluationData(sequences)
    const before = evaluateWeights(data, current?.weights ?? DEFAULT_WEIGHTS)
    const after = evaluateWeights(data, outcome.weights)
    if (!(after.rmse < before.rmse)) return { status: 'kept', reviews: outcome.reviews, before, after, fsrs: current }
    const standard = current ? evaluateWeights(data, DEFAULT_WEIGHTS) : before
    db.prepare(
      `INSERT INTO fsrs_params (user_id, weights, reviews, log_loss, rmse, default_log_loss, default_rmse, optimized_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET weights = excluded.weights, reviews = excluded.reviews,
         log_loss = excluded.log_loss, rmse = excluded.rmse, default_log_loss = excluded.default_log_loss,
         default_rmse = excluded.default_rmse, optimized_at = excluded.optimized_at`,
    ).run(
      userId,
      JSON.stringify(outcome.weights),
      outcome.reviews,
      after.logLoss,
      after.rmse,
      standard.logLoss,
      standard.rmse,
      Date.now(),
    )
    return { status: 'saved', reviews: outcome.reviews, before, after, fsrs: getFsrsParams(userId) }
  } finally {
    lock.__notedFsrsRunning = false
  }
}

/** Zurück zu den Standardwerten */
export function resetFsrsParams(userId: number): null {
  getDb().prepare('DELETE FROM fsrs_params WHERE user_id = ?').run(userId)
  return null
}
