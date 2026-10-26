// Wiederholungsplan für Karteikarten (Spaced Repetition) nach dem Vorbild von Anki (SM-2):
//
// - Neue Karten durchlaufen kurze Lernschritte (Standard 1 und 10 Minuten, je Stapel einstellbar), danach kommen sie
//   nach einem Tag wieder.
// - Gelernte Karten kommen in wachsenden Abständen (Abstand × Leichtigkeit) wieder.
// - „Nochmal“ bei einer gelernten Karte zählt als vergessen: Sie wird kurz neu gelernt, der Abstand halbiert
//   und die Leichtigkeit sinkt. „Schwer“/„Einfach“ verkürzen/verlängern den Abstand und passen die Leichtigkeit an.
import { fsrsInterval, initialMemory, memoryFromSm2, nextMemory, type Memory } from './fsrs'
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

/** Lernschritte für neue Karten (Minuten), wenn der Stapel keine eigenen hat */
export const DEFAULT_LEARNING_STEPS: readonly number[] = [1, 10]
/** Lernschritte nach dem Vergessen (Minuten) */
export const DEFAULT_RELEARNING_STEPS: readonly number[] = [10]
const GRADUATING_INTERVAL = 1
const EASY_INTERVAL = 4
const START_EASE = 2.5
const MIN_EASE = 1.3
/** Obergrenze wie auf dem Server (Anki-Importe bringen bis zu 10 mit) */
const MAX_EASE = 10
const EASY_BONUS = 1.3
const HARD_FACTOR = 1.2
/** Anteil des bisherigen Abstands nach dem Vergessen */
const LAPSE_FACTOR = 0.5
const MAX_INTERVAL = 36_500
/** Ab diesem Abstand (Tage) gilt eine Karte als „sicher“ */
const MATURE_INTERVAL = 21
/**
 * So oft vergessen, gilt eine Karte als Problemkarte (bei Anki „Leech“) – meist ist die Karte selbst das Problem.
 * Standard für neue Stapel, je Stapel einstellbar.
 */
export const LEECH_LAPSES = 6
export const DEFAULT_NEW_PER_DAY = 20
/** Gewünschte Behaltensrate mit FSRS */
export const DEFAULT_RETENTION = 0.9

const clampEase = (e: number) => Math.min(MAX_EASE, Math.max(MIN_EASE, Math.round(e * 100) / 100))
const clampInterval = (d: number) => Math.min(MAX_INTERVAL, Math.max(1, Math.round(d)))

/** Fester Hash eines Textes (FNV-1a, 32 Bit) – für Verteilungen, die für jede Kartenseite gleich bleiben */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return h >>> 0
}

// Streuung der Abstände wie bei Anki (rslib/src/scheduler/states/fuzz.rs): 1 Tag plus ein Anteil der Tage in jedem
// Bereich – unter 2,5 Tagen gar nicht
const FUZZ_RANGES = [
  { start: 2.5, end: 7, factor: 0.15 },
  { start: 7, end: 20, factor: 0.1 },
  { start: 20, end: Infinity, factor: 0.05 },
]

function fuzzDelta(days: number): number {
  if (days < 2.5) return 0
  return FUZZ_RANGES.reduce((delta, r) => delta + r.factor * Math.max(0, Math.min(days, r.end) - r.start), 1)
}

/**
 * Abstand in ganzen Tagen, mindestens `min`, höchstens MAX_INTERVAL. Mit `seed` (0 bis unter 1) liegt er irgendwo im
 * Bereich um `days` – so laufen Karten, die gemeinsam gelernt wurden, mit der Zeit auseinander, statt für immer am
 * selben Tag fällig zu sein. Ohne `seed` genau gerundet.
 */
export function fuzzInterval(days: number, seed: number | null, min = 1): number {
  const lo = Math.min(Math.max(1, min), MAX_INTERVAL)
  const d = Math.min(MAX_INTERVAL, Math.max(lo, days))
  if (seed === null) return Math.round(d)
  const delta = fuzzDelta(d)
  const clamp = (n: number) => Math.min(MAX_INTERVAL, Math.max(lo, n))
  const lower = clamp(Math.round(d - delta))
  let upper = clamp(Math.round(d + delta))
  if (upper === lower && upper > 2 && upper < MAX_INTERVAL) upper = lower + 1
  return Math.floor(lower + seed * (1 + upper - lower))
}

/** Streuung für eine Bewertung: fest je Kartenseite und Wiederholung, damit Knopf und Bewertung denselben Tag ergeben */
const fuzzSeed = (key: string | undefined, reps: number) => (key ? fnv1a(`${key}:${reps}`) / 2 ** 32 : null)

/** Lernschritte eines Stapels in Minuten – ohne Angabe die Standardwerte */
type Steps = { learningSteps?: readonly number[]; relearningSteps?: readonly number[] }

/**
 * Wiederholungsplan eines Stapels: SM-2 (wie Anki) oder FSRS mit gewünschter Behaltensrate – `weights`: auf den eigenen
 * Lernverlauf optimierte Gewichte (sonst die Standardwerte)
 */
export type Plan = ({ kind: 'sm2' } | { kind: 'fsrs'; retention: number; weights?: readonly number[] }) & Steps

export const SM2: Plan = { kind: 'sm2' }

/** FSRS: Stabilität und Schwierigkeit nach der Bewertung – bisher mit SM-2 geplante Seiten werden umgerechnet */
function fsrsMemory(prev: SrsState | null, rating: Rating, now: number, weights?: readonly number[]): Memory {
  if (!prev) return initialMemory(rating, weights)
  const memory =
    prev.stability != null && prev.difficulty != null
      ? { stability: prev.stability, difficulty: prev.difficulty }
      : memoryFromSm2(prev.interval, prev.ease, weights)
  return nextMemory(memory, rating, calendarDays(prev.reviewedAt, now), weights)
}

/**
 * Vergangene Kalendertage (Ortszeit) – wie beim Optimieren der Gewichte (fsrs-dataset.ts). Karten sind ab 0 Uhr ihres
 * Fälligkeitstags dran: Abends bewertet und am nächsten Morgen wiederholt ist ein Tag, nicht ein halber.
 */
function calendarDays(from: number, to: number): number {
  // Gerundet, weil Tage mit Zeitumstellung 23 oder 25 Stunden haben
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY)
}

/**
 * Neuer Lernstand nach einer Bewertung. `prev` = null bei einer neuen Karte. Mit `key` (Kartenseite, siehe itemKey)
 * werden Abstände ab 2,5 Tagen leicht gestreut.
 */
export function schedule(prev: SrsState | null, rating: Rating, now: number, plan: Plan = SM2, key?: string): SrsState {
  const seed = fuzzSeed(key, prev?.reps ?? 0)
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
  // FSRS: Abstand in Tagen aus der Stabilität nach der jeweiligen Bewertung
  const fsrsDays = (r: Rating) => {
    if (plan.kind !== 'fsrs') return 0
    return clampInterval(fsrsInterval(fsrsMemory(prev, r, now, plan.weights).stability, plan.retention))
  }
  if (plan.kind === 'fsrs') {
    const memory = fsrsMemory(prev, rating, now, plan.weights)
    s.stability = memory.stability
    s.difficulty = memory.difficulty
  }

  const learningSteps = plan.learningSteps?.length ? plan.learningSteps : DEFAULT_LEARNING_STEPS
  const relearningSteps = plan.relearningSteps?.length ? plan.relearningSteps : DEFAULT_RELEARNING_STEPS

  if (s.phase === 'review') {
    if (rating === 1) {
      s.lapses += 1
      s.ease = clampEase(s.ease - 0.2)
      s.interval = plan.kind === 'fsrs' ? fsrsDays(1) : clampInterval(s.interval * LAPSE_FACTOR)
      s.phase = 'relearning'
      s.step = 0
      s.due = now + relearningSteps[0] * MINUTE
      return s
    }
    // Jeder Abstand mit Untergrenze – gestreut bleibt so Schwer ≤ Gut < Einfach
    const fuzz = (days: number, min = 1) => fuzzInterval(days, seed, min)
    let hard: number, good: number, easy: number
    if (plan.kind === 'fsrs') {
      // Wie in der Referenz von FSRS: Schwer ≤ Gut < Einfach
      hard = fuzz(Math.min(fsrsDays(2), fsrsDays(3)))
      good = fuzz(fsrsDays(3), hard + 1)
      easy = fuzz(fsrsDays(4), good + 1)
    } else if (prev && prev.due - now > DAY) {
      // Vorgezogen (vor einer Klausur): Der Abstand wächst nur um die tatsächlich vergangene Zeit, bei „Gut“ und
      // „Einfach“ wird er aber nicht kürzer als bisher – wie bei Anki
      const elapsed = (now - prev.reviewedAt) / DAY
      hard = fuzz(Math.max((s.interval * HARD_FACTOR) / 2, elapsed * HARD_FACTOR))
      good = fuzz(Math.max(s.interval, Math.round(elapsed * s.ease)), hard + 1)
      const easyBonus = (1 + EASY_BONUS) / 2
      easy = fuzz(Math.round(Math.max(s.interval, elapsed * s.ease) * easyBonus), good + 1)
    } else {
      // Zu spät wiederholte Karten wurden trotzdem gewusst – das zählt teilweise mit
      const overdue = Math.max(0, (now - (prev?.due ?? now)) / DAY)
      hard = fuzz(Math.round((s.interval + overdue / 4) * HARD_FACTOR), s.interval + 1)
      good = fuzz(Math.round((s.interval + overdue / 2) * s.ease), hard + 1)
      easy = fuzz(Math.round((s.interval + overdue) * s.ease * EASY_BONUS), good + 1)
    }
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
  const steps = s.phase === 'relearning' ? relearningSteps : learningSteps
  const step = Math.min(s.step, steps.length - 1)
  const graduate = (days: number) => {
    s.phase = 'review'
    s.step = 0
    s.interval = days
    s.due = now + s.interval * DAY
    return s
  }
  // Abstand beim Abschluss mit „Gut“ – „Einfach“ liegt auch gestreut darüber
  const graduateGood = () =>
    fuzzInterval(plan.kind === 'fsrs' ? fsrsDays(3) : s.phase === 'relearning' ? s.interval : GRADUATING_INTERVAL, seed)
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
      return graduate(graduateGood())
    default: {
      const easy = plan.kind === 'fsrs' ? fsrsDays(4) : s.phase === 'relearning' ? s.interval + 1 : EASY_INTERVAL
      return graduate(fuzzInterval(easy, seed, graduateGood() + 1))
    }
  }
}

/** Abstand bis zur nächsten Abfrage für jede Bewertung (für die Beschriftung der Knöpfe) – `key` wie bei schedule */
export function previewIntervals(prev: SrsState | null, now: number, plan: Plan = SM2, key?: string): Record<Rating, number> {
  const out = {} as Record<Rating, number>
  for (const { rating } of RATINGS) out[rating] = schedule(prev, rating, now, plan, key).due - now
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
