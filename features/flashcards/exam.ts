// Klausurmodus: Stapel, die im Kalender mit einer Klausur verknüpft sind, werden bis zum Prüfungstag wiederholt.
// Was erst am Klausurtag oder danach fällig wäre, kommt an einem der letzten Tage davor dran – verteilt auf bis zu
// EXAM_REVIEW_DAYS Tage, damit nicht alles am Vortag liegt. Gespeichert bleibt der eigentliche Plan: Nach der Klausur
// gilt er wieder, ohne dass etwas zurückgesetzt werden muss.
import { addDays, dateOf, daysBetween, localDate } from '@/features/calendar/dates'
import type { CalendarEvent } from '@/features/calendar/types'
import { startOfDay } from './srs'
import type { DeckExam, SrsState } from './types'

/** Auf so viele Tage vor der Klausur verteilen sich die vorgezogenen Wiederholungen */
export const EXAM_REVIEW_DAYS = 3

/** Klausuren je Stapel, sortiert nach Datum */
export function examsByDeck(events: CalendarEvent[]): Map<string, DeckExam[]> {
  const map = new Map<string, DeckExam[]>()
  const exams = events.filter((e) => e.exam).sort((a, b) => a.start.localeCompare(b.start))
  for (const e of exams) {
    const exam = { id: e.id, title: e.title, date: dateOf(e.start) }
    for (const deckId of e.exam?.deckIds ?? []) map.set(deckId, [...(map.get(deckId) ?? []), exam])
  }
  return map
}

/** Die nächste Klausur, die noch bevorsteht – am Klausurtag selbst gilt schon wieder der normale Plan */
export function nextExam(exams: DeckExam[] | undefined, now: number): DeckExam | null {
  const today = localDate(new Date(now))
  return exams?.find((e) => e.date > today) ?? null
}

/** Tage bis zur Klausur (morgen = 1) */
export const daysUntil = (exam: DeckExam, now: number) => daysBetween(localDate(new Date(now)), exam.date)

/** Beginn des Tages in Ortszeit */
const dayStart = (date: string) => new Date(`${date}T00:00`).getTime()

/** Gleichmäßige, aber für jede Kartenseite feste Verteilung auf die Tage vor der Klausur (FNV-1a) */
function slot(key: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193)
  return (h >>> 0) % EXAM_REVIEW_DAYS
}

/**
 * Fälligkeit einer Kartenseite (`key`) vor der Klausur. Gelernte Seiten, die erst am Klausurtag oder danach dran
 * wären, rücken auf einen der letzten Tage davor – außer sie wurden in diesen Tagen schon wiederholt.
 */
export function examDue(state: SrsState, key: string, exam: DeckExam, now: number): number {
  if (state.phase !== 'review' || state.due < dayStart(exam.date)) return state.due
  if (state.reviewedAt >= dayStart(addDays(exam.date, -EXAM_REVIEW_DAYS))) return state.due
  // Kurzfristig angelegte Klausur: Was schon hätte drankommen sollen, ist heute fällig
  return Math.max(dayStart(addDays(exam.date, -1 - slot(key))), startOfDay(now))
}

/**
 * Vorschlag für das Tageslimit: so viele neue Karten pro Tag, dass bis zum Vortag der Klausur alle einmal gelernt
 * sind. `newLeft` = noch nie gelernte Seiten, `introducedToday` = heute schon neu gelernte (zählen für heute mit).
 */
export function examNewPerDay(newLeft: number, introducedToday: number, exam: DeckExam, now: number): number {
  if (newLeft === 0) return 0
  return Math.ceil((newLeft + introducedToday) / Math.max(1, daysUntil(exam, now)))
}
