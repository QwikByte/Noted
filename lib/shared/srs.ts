// Wiederholungsplan für Karteikarten (Spaced Repetition) nach dem Vorbild von Anki (SM-2):
//
// - Neue Karten durchlaufen kurze Lernschritte (1 und 10 Minuten), danach kommen sie nach einem Tag wieder.
// - Gelernte Karten kommen in wachsenden Abständen (Abstand × Leichtigkeit) wieder.
// - „Nochmal“ bei einer gelernten Karte zählt als vergessen: Sie wird kurz neu gelernt, der Abstand halbiert
//   und die Leichtigkeit sinkt. „Schwer“/„Einfach“ verkürzen/verlängern den Abstand und passen die Leichtigkeit an.
import type { SrsState } from './types'

export type Rating = 1 | 2 | 3 | 4

export const RATINGS: { rating: Rating; label: string; key: string }[] = [
  { rating: 1, label: 'Nochmal', key: '1' },
  { rating: 2, label: 'Schwer', key: '2' },
  { rating: 3, label: 'Gut', key: '3' },
  { rating: 4, label: 'Einfach', key: '4' },
]

export const MINUTE = 60_000
export const DAY = 86_400_000

/** Lernschritte für neue Karten (Minuten) */
const LEARNING_STEPS = [1, 10]
/** Lernschritte nach dem Vergessen (Minuten) */
const RELEARNING_STEPS = [10]
const GRADUATING_INTERVAL = 1
const EASY_INTERVAL = 4
const START_EASE = 2.5
const MIN_EASE = 1.3
const EASY_BONUS = 1.3
const HARD_FACTOR = 1.2
/** Anteil des bisherigen Abstands nach dem Vergessen */
const LAPSE_FACTOR = 0.5
const MAX_INTERVAL = 36_500
/** Ab diesem Abstand (Tage) gilt eine Karte als „sicher“ */
const MATURE_INTERVAL = 21
export const DEFAULT_NEW_PER_DAY = 20

const clampEase = (e: number) => Math.max(MIN_EASE, Math.round(e * 100) / 100)
const clampInterval = (d: number) => Math.min(MAX_INTERVAL, Math.max(1, Math.round(d)))

/** Neuer Lernstand nach einer Bewertung. `prev` = null bei einer neuen Karte. */
export function schedule(prev: SrsState | null, rating: Rating, now: number): SrsState {
  const s: SrsState = prev
    ? { ...prev }
    : {
        phase: 'learning',
        step: 0,
        interval: 0,
        ease: START_EASE,
        reps: 0,
        lapses: 0,
        due: now,
        reviewedAt: now,
        introducedAt: now,
      }
  s.reps += 1
  s.reviewedAt = now

  if (s.phase === 'review') {
    if (rating === 1) {
      s.lapses += 1
      s.ease = clampEase(s.ease - 0.2)
      s.interval = clampInterval(s.interval * LAPSE_FACTOR)
      s.phase = 'relearning'
      s.step = 0
      s.due = now + RELEARNING_STEPS[0] * MINUTE
      return s
    }
    // Zu spät wiederholte Karten wurden trotzdem gewusst – das zählt teilweise mit
    const overdue = Math.max(0, (now - (prev?.due ?? now)) / DAY)
    const hard = Math.min(MAX_INTERVAL, Math.max(s.interval + 1, Math.round((s.interval + overdue / 4) * HARD_FACTOR)))
    const good = Math.min(MAX_INTERVAL, Math.max(hard + 1, Math.round((s.interval + overdue / 2) * s.ease)))
    const easy = Math.min(MAX_INTERVAL, Math.max(good + 1, Math.round((s.interval + overdue) * s.ease * EASY_BONUS)))
    if (rating === 2) {
      s.interval = hard
      s.ease = clampEase(s.ease - 0.15)
    } else if (rating === 3) {
      s.interval = good
    } else {
      s.interval = easy
      s.ease = clampEase(s.ease + 0.15)
    }
    s.due = now + s.interval * DAY
    return s
  }

  // Lernphase (neu oder nach dem Vergessen)
  const steps = s.phase === 'relearning' ? RELEARNING_STEPS : LEARNING_STEPS
  const step = Math.min(s.step, steps.length - 1)
  const graduate = (days: number) => {
    s.phase = 'review'
    s.step = 0
    s.interval = clampInterval(days)
    s.due = now + s.interval * DAY
    return s
  }
  switch (rating) {
    case 1:
      s.step = 0
      s.due = now + steps[0] * MINUTE
      return s
    case 2: {
      // Im ersten Schritt: Mitte zwischen erstem und zweitem Schritt
      const delay = step === 0 && steps.length > 1 ? (steps[0] + steps[1]) / 2 : steps[step]
      s.due = now + delay * MINUTE
      return s
    }
    case 3:
      if (step + 1 < steps.length) {
        s.step = step + 1
        s.due = now + steps[s.step] * MINUTE
        return s
      }
      return graduate(s.phase === 'relearning' ? s.interval : GRADUATING_INTERVAL)
    default:
      return graduate(s.phase === 'relearning' ? s.interval + 1 : EASY_INTERVAL)
  }
}

/** Abstand bis zur nächsten Abfrage für jede Bewertung (für die Beschriftung der Knöpfe). */
export function previewIntervals(prev: SrsState | null, now: number): Record<Rating, number> {
  const out = {} as Record<Rating, number>
  for (const { rating } of RATINGS) out[rating] = schedule(prev, rating, now).due - now
  return out
}

/** „1 Min.“, „10 Min.“, „1 Tag“, „3 Tage“, „2,5 Mon.“, „1,2 J.“ */
export function formatInterval(ms: number): string {
  const min = ms / MINUTE
  if (min < 60) return `${Math.max(1, Math.round(min))} Min.`
  const hours = min / 60
  if (hours < 24) return `${Math.round(hours)} Std.`
  const days = Math.round(ms / DAY)
  if (days < 31) return days === 1 ? '1 Tag' : `${days} Tage`
  const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString('de-DE')
  if (days < 365) return `${fmt(days / 30.4)} Mon.`
  return `${fmt(days / 365)} J.`
}

/** Ende des Kalendertags (Ortszeit) – gelernte Karten sind den ganzen Fälligkeitstag über dran. */
export function endOfDay(now: number): number {
  const d = new Date(now)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

export function startOfDay(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export type CardStatus = 'new' | 'learning' | 'young' | 'mature'

export function cardStatus(state: SrsState | null | undefined): CardStatus {
  if (!state) return 'new'
  if (state.phase !== 'review') return 'learning'
  return state.interval >= MATURE_INTERVAL ? 'mature' : 'young'
}
