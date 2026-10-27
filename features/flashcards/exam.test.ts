import { describe, expect, it } from 'vitest'
import { blankEvent } from '@/features/calendar/event'
import type { CalendarEvent } from '@/features/calendar/types'
import { EXAM_REVIEW_DAYS, examDue, examNewPerDay, examReviewsPerDay, examsByDeck, nextExam } from './exam'
import { DAY, schedule, startOfDay } from './srs'
import { deckCounts, reviewKey, stateMap } from './study'
import type { Card, CardReview, DeckExam, SrsState } from './types'

// Mittwoch, 14.10.2026, 10 Uhr Ortszeit
const NOW = new Date('2026-10-14T10:00:00').getTime()
const day = (date: string) => new Date(`${date}T00:00`).getTime()

/** Gelernte Kartenseite, zuletzt vor `ago` Tagen wiederholt und in `inDays` Tagen fällig */
function learned(ago: number, inDays: number, interval = ago + inDays): SrsState {
  return {
    phase: 'review',
    step: 0,
    interval,
    ease: 2.5,
    reps: 5,
    lapses: 0,
    due: NOW + inDays * DAY,
    reviewedAt: NOW - ago * DAY,
    introducedAt: NOW - 60 * DAY,
  }
}

function event(id: string, start: string, deckIds: string[] | null, repeat = false): CalendarEvent {
  return {
    ...blankEvent(start),
    id,
    title: id,
    repeat: repeat ? { weeks: 1, until: null } : null,
    exam: deckIds ? { deckIds } : null,
    createdAt: 0,
    updatedAt: 0,
  }
}

const exam = (date: string): DeckExam => ({ id: 'k', title: 'Analysis I', date })

describe('Klausuren der Stapel', () => {
  it('ordnet Klausuren ihren Stapeln zu und nimmt die nächste, die noch bevorsteht', () => {
    const map = examsByDeck([
      event('Nachklausur', '2027-03-01T09:00', ['d1']),
      event('Vorlesung', '2026-10-20T10:15', null, true),
      event('Klausur', '2026-10-24T09:00', ['d1', 'd2']),
      event('Gestern', '2026-10-13T09:00', ['d1']),
      event('Heute', '2026-10-14T14:00', ['d1']),
    ])
    expect(map.get('d1')?.map((e) => e.id)).toEqual(['Gestern', 'Heute', 'Klausur', 'Nachklausur'])
    expect(map.get('d2')).toEqual([{ id: 'Klausur', title: 'Klausur', date: '2026-10-24' }])
    // Am Klausurtag selbst gilt wieder der normale Plan
    expect(nextExam(map.get('d1'), NOW)?.id).toBe('Klausur')
    expect(nextExam(map.get('d3'), NOW)).toBeNull()
    expect(nextExam(undefined, NOW)).toBeNull()
  })
})

describe('Wiederholungen vor der Klausur', () => {
  const k = exam('2026-10-24')
  const window = [day('2026-10-21'), day('2026-10-22'), day('2026-10-23')]

  it('zieht, was erst am Klausurtag oder danach fällig wäre, in die letzten Tage davor – verteilt und fest je Seite', () => {
    const state = learned(10, 16)
    const dues = Array.from({ length: 300 }, (_, i) => examDue(state, `c${i}:0`, k, NOW))
    expect(new Set(dues)).toEqual(new Set(window))
    for (const d of window) expect(dues.filter((x) => x === d).length).toBeGreaterThan(300 / EXAM_REVIEW_DAYS / 2)
    expect(examDue(state, 'c7:0', k, NOW)).toBe(dues[7])
    // Genau am Klausurtag fällig zählt auch
    expect(window).toContain(examDue({ ...state, due: day('2026-10-24') + 9 * 3_600_000 }, 'x:0', k, NOW))
  })

  it('lässt Seiten in Ruhe, die vorher fällig sind, gerade gelernt werden oder kurz vor der Klausur wiederholt wurden', () => {
    const before = learned(5, 4)
    expect(examDue(before, 'a:0', k, NOW)).toBe(before.due)
    const relearning = { ...learned(5, 0), phase: 'relearning' as const, due: NOW + 600_000 }
    expect(examDue(relearning, 'a:0', k, NOW)).toBe(relearning.due)
    const fresh = { ...learned(0, 30), reviewedAt: day('2026-10-21') + 1000 }
    expect(examDue(fresh, 'a:0', k, NOW)).toBe(fresh.due)
  })

  it('macht bei einer kurzfristigen Klausur alles Nötige heute fällig', () => {
    const tomorrow = exam('2026-10-15')
    const dues = Array.from({ length: 50 }, (_, i) => examDue(learned(10, 20), `c${i}:0`, tomorrow, NOW))
    expect(new Set(dues)).toEqual(new Set([startOfDay(NOW)]))
  })

  it('zählt die vorgezogenen Seiten im Stapel mit – nach der Klausur gilt wieder der eigene Plan', () => {
    const cards: Card[] = ['c1', 'c2', 'c3'].map((id, i) => ({
      id,
      deckId: 'd1',
      noteId: null,
      type: 'basic',
      front: id,
      back: '',
      options: [],
      occlusion: null,
      position: i,
      suspended: id === 'c3',
      createdAt: 0,
      updatedAt: 0,
    }))
    const reviews: CardReview[] = cards.map((c) => ({ cardId: c.id, side: 0, ...learned(10, 20) }))
    const states = stateMap(reviews)
    const deck = { newPerDay: 20, reviewPerDay: 9999, exams: [exam('2026-10-15')] }
    expect(deckCounts({ newPerDay: 20, reviewPerDay: 9999 }, cards, states, NOW)).toMatchObject({ review: 0, due: 0 })
    // Ausgesetzte Karten bleiben auch vor der Klausur draußen
    expect(deckCounts(deck, cards, states, NOW)).toMatchObject({ review: 2, due: 2 })
    expect(deckCounts(deck, cards, states, day('2026-10-15') + 8 * 3_600_000)).toMatchObject({ review: 0, due: 0 })
    expect(states.get(reviewKey('c1', 0))?.due).toBe(NOW + 20 * DAY)
  })
})

describe('Vorschlag für neue Karten', () => {
  it('verteilt die neuen Karten auf die Tage bis zur Klausur', () => {
    expect(examNewPerDay(100, 0, exam('2026-10-24'), NOW)).toBe(10)
    expect(examNewPerDay(95, 6, exam('2026-10-24'), NOW)).toBe(11)
    expect(examNewPerDay(30, 0, exam('2026-10-15'), NOW)).toBe(30)
    expect(examNewPerDay(0, 4, exam('2026-10-24'), NOW)).toBe(0)
  })
})

describe('Klausur und Beginn des Lerntags', () => {
  it('zählt die Nacht vor der Klausur noch zum Vortag', () => {
    const night = new Date('2026-10-15T01:00:00').getTime()
    const exams = [exam('2026-10-15')]
    expect(nextExam(exams, night)).toBeNull()
    expect(nextExam(exams, night, 4)?.date).toBe('2026-10-15')
    // Erst nach der Klausur fällig: rückt auf den Lerntag davor, der um 4 Uhr begann
    const state = learned(10, 20)
    expect(examDue(state, 'c1:0', exams[0], night, 4)).toBe(new Date('2026-10-14T04:00:00').getTime())
  })
})

describe('Vorschlag für Wiederholungen', () => {
  it('richtet sich nach dem engsten Rest bis zur Klausur – meist den Tagen mit den vorgezogenen Wiederholungen', () => {
    const dues = [
      ...Array<number>(50).fill(NOW - DAY),
      ...Array<number>(10).fill(day('2026-10-21')),
      ...Array<number>(10).fill(day('2026-10-22') + 9 * 3_600_000),
      ...Array<number>(10).fill(day('2026-10-23')),
      // Am Klausurtag und danach zählt nichts
      ...Array<number>(5).fill(day('2026-10-24')),
      ...Array<number>(3).fill(day('2026-10-30')),
    ]
    // 10 Tage bis zur Klausur: im Schnitt 8 pro Tag, in den letzten drei Tagen aber je 10
    expect(examReviewsPerDay(dues, 0, exam('2026-10-24'), NOW)).toBe(10)
    // Heute schon 40 wiederholt: (40 + 80) / 10
    expect(examReviewsPerDay(dues, 40, exam('2026-10-24'), NOW)).toBe(12)
    expect(examReviewsPerDay([], 0, exam('2026-10-24'), NOW)).toBe(0)
  })

  it('meldet, wenn das Tageslimit vor der Klausur nicht reicht', () => {
    const cards: Card[] = Array.from({ length: 40 }, (_, i) => ({
      id: `c${i}`,
      deckId: 'd1',
      noteId: null,
      type: 'basic',
      front: `c${i}`,
      back: '',
      options: [],
      occlusion: null,
      position: i,
      suspended: false,
      createdAt: 0,
      updatedAt: 0,
    }))
    const states = stateMap(cards.map((c) => ({ cardId: c.id, side: 0, ...learned(10, 20) })))
    // Klausur morgen: alles kommt heute dran, das Limit lässt aber nur 10 zu
    const deck = { newPerDay: 20, reviewPerDay: 10, exams: [exam('2026-10-15')] }
    expect(deckCounts(deck, cards, states, NOW)).toMatchObject({ review: 10, reviewWaiting: 30, examReviewsPerDay: 40 })
    expect(deckCounts({ ...deck, exams: [] }, cards, states, NOW)).toMatchObject({ review: 0, examReviewsPerDay: 0 })
  })
})

describe('Vorgezogene Wiederholung mit SM-2', () => {
  it('lässt den Abstand nur um die vergangene Zeit wachsen, aber nicht schrumpfen', () => {
    const early = learned(50, 10, 60)
    const ivl = (r: 2 | 3 | 4, s = early) => schedule(s, r, NOW).interval
    // Pünktlich wären es 60 × 2,5 = 150 Tage
    expect(schedule({ ...early, due: NOW }, 3, NOW).interval).toBe(150)
    expect([ivl(2), ivl(3), ivl(4)]).toEqual([60, 125, 144])
    // Erst vor zwei Tagen wiederholt: nicht kürzer als bisher
    const recent = learned(2, 28, 30)
    expect(ivl(3, recent)).toBe(30)
    expect(ivl(2, recent)).toBeLessThan(ivl(3, recent))
    expect(ivl(4, recent)).toBeGreaterThan(ivl(3, recent))
  })
})
