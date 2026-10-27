// Lernstatistik: Einträge fürs Bewertungsprotokoll, Auswertung nach Tagen und Stapeln, Serie und Vorschau fälliger
// Karten. Reine Logik ohne Browser- oder Server-Abhängigkeit.
import { addDays } from '@/features/calendar/dates'
import { DAY, startOfDay, type Rating } from './srs'
import { reviewKey, sidesOf, type Side, type StateMap } from './study'
import { MAX_ANSWER_MS } from './limits'
import { examDue, nextExam } from './exam'
import type { Card, Deck, DeckStudyStats, ReviewLogEntry, SrsState, StudyDay } from './types'

/** Protokolleintrag für eine Bewertung: `shownAt` = Zeitpunkt, zu dem die Karte angezeigt wurde */
export function reviewLogEntry(
  cardId: string,
  side: Side,
  prev: SrsState | null,
  next: SrsState,
  rating: Rating,
  shownAt: number,
): ReviewLogEntry {
  const now = next.reviewedAt
  return {
    cardId,
    side,
    rating,
    phase: prev?.phase ?? 'new',
    intervalBefore: prev ? Math.max(0, (prev.due - prev.reviewedAt) / DAY) : 0,
    intervalAfter: Math.max(0, (next.due - now) / DAY),
    durationMs: Math.min(MAX_ANSWER_MS, Math.max(0, Math.round(now - shownAt))),
    reviewedAt: now,
  }
}

export type LogRow = { reviewedAt: number; rating: number; phase: string; deckId: string | null; durationMs: number }

/**
 * Bewertungen nach Tagen (`dayOf` rechnet in die Ortszeit des Geräts) und – ab `recentSince` – nach Stapeln.
 * Die Trefferquote zählt nur Wiederholungen gelernter Karten: „Nochmal“ ist dort vergessen, alles andere gewusst.
 */
export function aggregateLog(
  rows: LogRow[],
  dayOf: (t: number) => string,
  recentSince: number,
): { days: StudyDay[]; decks: DeckStudyStats[] } {
  const days = new Map<string, StudyDay>()
  const decks = new Map<string, DeckStudyStats>()
  for (const r of rows) {
    const date = dayOf(r.reviewedAt)
    const day = days.get(date) ?? { date, reviews: 0, again: 0, ms: 0 }
    day.reviews++
    if (r.rating === 1) day.again++
    day.ms += r.durationMs
    days.set(date, day)
    if (r.reviewedAt < recentSince || !r.deckId) continue
    const deck = decks.get(r.deckId) ?? { deckId: r.deckId, reviews: 0, ms: 0, matureReviews: 0, matureCorrect: 0 }
    deck.reviews++
    deck.ms += r.durationMs
    if (r.phase === 'review') {
      deck.matureReviews++
      if (r.rating > 1) deck.matureCorrect++
    }
    decks.set(r.deckId, deck)
  }
  return {
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    decks: [...decks.values()],
  }
}

/**
 * Lernserie: Tage am Stück mit mindestens einer Bewertung. Die aktuelle Serie zählt bis heute – ist heute noch
 * nichts gelernt, bis gestern (sie reißt erst, wenn der Tag ohne Lernen vorbei ist).
 */
export function streaks(dates: Iterable<string>, today: string): { current: number; longest: number } {
  const set = new Set(dates)
  let current = 0
  for (let d = set.has(today) ? today : addDays(today, -1); set.has(d); d = addDays(d, -1)) current++
  let longest = 0
  for (const d of set) {
    if (set.has(addDays(d, -1))) continue
    let n = 0
    for (let x = d; set.has(x); x = addDays(x, 1)) n++
    longest = Math.max(longest, n)
  }
  return { current, longest }
}

/**
 * Vorschau: fällige Kartenseiten je Tag ab heute (Index 0 = heute, Überfälliges eingeschlossen). Neue Karten zählen
 * nicht mit – wie viele davon dazukommen, regelt das Tageslimit je Stapel. Ausgesetzte Karten zählen nicht. Steht für
 * einen der `decks` eine Klausur an, gelten die vorgezogenen Tage wie beim Lernen. `dayStartHour`: Beginn des Lerntags.
 */
export function dueForecast(
  decks: Pick<Deck, 'id' | 'exams'>[],
  cards: Card[],
  states: StateMap,
  now: number,
  days: number,
  dayStartHour = 0,
): number[] {
  const out = new Array<number>(days).fill(0)
  const today = startOfDay(now, dayStartHour)
  // Wie im Stapel: Vor einer Klausur rücken spätere Wiederholungen auf die Tage davor (exam.ts)
  const exams = new Map(decks.map((d) => [d.id, nextExam(d.exams, now, dayStartHour)]))
  for (const card of cards) {
    if (card.suspended) continue
    const exam = exams.get(card.deckId) ?? null
    for (const side of sidesOf(card)) {
      const key = reviewKey(card.id, side)
      const state = states.get(key)
      if (!state) continue
      const due = exam ? examDue(state, key, exam, now, dayStartHour) : state.due
      // Gerundet, weil Tage mit Zeitumstellung 23 oder 25 Stunden haben
      const index = Math.max(0, Math.round((startOfDay(due, dayStartHour) - today) / DAY))
      if (index < days) out[index]++
    }
  }
  return out
}
