// Klausurmodus: Stapel, die im Kalender mit einer Klausur verknüpft sind, werden bis zum Prüfungstag wiederholt.
// Was erst am Klausurtag oder danach fällig wäre, kommt an einem der letzten Tage davor dran – verteilt auf bis zu
// EXAM_REVIEW_DAYS Tage, damit nicht alles am Vortag liegt. Gespeichert bleibt der eigentliche Plan: Nach der Klausur
// gilt er wieder, ohne dass etwas zurückgesetzt werden muss.
import { addDays, dateOf, daysBetween } from '@/features/calendar/dates'
import type { CalendarEvent } from '@/features/calendar/types'
import { fnv1a, startOfDay, studyDate } from './srs'
import type { DeckExam, SrsState } from './types'

/** Auf so viele Tage vor der Klausur verteilen sich die vorgezogenen Wiederholungen */
export const EXAM_REVIEW_DAYS = 3

/** Klausuren je Stapel, sortiert nach Datum */
export function examsByDeck(events: CalendarEvent[]): Map<string, DeckExam[]> {
  const map = new Map<string, DeckExam[]>()
  const exams = events.filter((e) => e.exam).sort((a, b) => a.start.localeCompare(b.start))
  for (const e of exams) {
    const exam = { id: e.id, title: e.title, date: dateOf(e.start) }
    for (const deckId of e.exam?.deckIds ?? []) {
      const list = map.get(deckId)
      if (list) list.push(exam)
      else map.set(deckId, [exam])
    }
  }
  return map
}

// `dayStartHour` überall: Beginn des Lerntags (Einstellung des Kontos, siehe startOfDay)

/** Die nächste Klausur, die noch bevorsteht – am Klausurtag selbst gilt schon wieder der normale Plan */
export function nextExam(exams: DeckExam[] | undefined, now: number, dayStartHour = 0): DeckExam | null {
  const today = studyDate(now, dayStartHour)
  return exams?.find((e) => e.date > today) ?? null
}

/** Tage bis zur Klausur (morgen = 1) */
export const daysUntil = (exam: DeckExam, now: number, dayStartHour = 0) =>
  daysBetween(studyDate(now, dayStartHour), exam.date)

/** Beginn des Lerntags in Ortszeit */
const dayStart = (date: string, dayStartHour: number) =>
  new Date(`${date}T${String(dayStartHour).padStart(2, '0')}:00`).getTime()

/** Gleichmäßige, aber für jede Kartenseite feste Verteilung auf die Tage vor der Klausur */
const slot = (key: string) => fnv1a(key) % EXAM_REVIEW_DAYS

/**
 * Fälligkeit einer Kartenseite (`key`) vor der Klausur. Gelernte Seiten, die erst am Klausurtag oder danach dran
 * wären, rücken auf einen der letzten Tage davor – außer sie wurden in diesen Tagen schon wiederholt.
 */
export function examDue(state: SrsState, key: string, exam: DeckExam, now: number, dayStartHour = 0): number {
  if (state.phase !== 'review' || state.due < dayStart(exam.date, dayStartHour)) return state.due
  if (state.reviewedAt >= dayStart(addDays(exam.date, -EXAM_REVIEW_DAYS), dayStartHour)) return state.due
  // Kurzfristig angelegte Klausur: Was schon hätte drankommen sollen, ist heute fällig
  return Math.max(dayStart(addDays(exam.date, -1 - slot(key)), dayStartHour), startOfDay(now, dayStartHour))
}

/**
 * Vorschlag für das Tageslimit: so viele neue Karten pro Tag, dass bis zum Vortag der Klausur alle einmal gelernt
 * sind. `newLeft` = noch nie gelernte Seiten, `introducedToday` = heute schon neu gelernte (zählen für heute mit).
 */
export function examNewPerDay(
  newLeft: number,
  introducedToday: number,
  exam: DeckExam,
  now: number,
  dayStartHour = 0,
): number {
  if (newLeft === 0) return 0
  return Math.ceil((newLeft + introducedToday) / Math.max(1, daysUntil(exam, now, dayStartHour)))
}

/**
 * Vorschlag für das Tageslimit an Wiederholungen: so viele pro Tag, dass bis zum Vortag der Klausur jede Seite
 * drankommt, die bis dahin fällig ist (`dues`, schon mit `examDue`). `reviewsToday` = heute schon wiederholte Seiten.
 * Was an einem Tag fällig wird, lässt sich erst ab diesem Tag lernen – den Ausschlag gibt der engste Rest bis zur
 * Klausur, meist die letzten Tage mit den vorgezogenen Wiederholungen.
 */
export function examReviewsPerDay(
  dues: number[],
  reviewsToday: number,
  exam: DeckExam,
  now: number,
  dayStartHour = 0,
): number {
  const days = Math.max(1, daysUntil(exam, now, dayStartHour))
  const end = dayStart(exam.date, dayStartHour)
  const today = startOfDay(now, dayStartHour)
  const load = new Array<number>(days).fill(0)
  for (const due of dues) {
    if (due >= end) continue
    const day = Math.round((startOfDay(due, dayStartHour) - today) / 86_400_000)
    load[Math.min(days - 1, Math.max(0, day))]++
  }
  load[0] += reviewsToday
  let need = 0
  let rest = 0
  for (let day = days - 1; day >= 0; day--) {
    rest += load[day]
    need = Math.max(need, Math.ceil(rest / (days - day)))
  }
  return need
}
