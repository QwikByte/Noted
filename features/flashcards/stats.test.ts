import { describe, expect, it } from 'vitest'
import { DAY, MINUTE, schedule } from './srs'
import { aggregateLog, dayKey, dueForecast, reviewLogEntry, shiftDay, streaks, type LogRow } from './stats'
import { stateMap } from './study'
import type { Card, CardReview } from './types'

const NOW = new Date('2026-10-14T10:00:00').getTime()

const card = (id: string, patch: Partial<Card> = {}): Card => ({
  id,
  deckId: 'd1',
  noteId: null,
  type: 'basic',
  front: id,
  back: id,
  options: [],
  position: 0,
  suspended: false,
  createdAt: 0,
  updatedAt: 0,
  ...patch,
})

describe('Bewertungsprotokoll', () => {
  it('hält Phase vorher, Abstände und die (gekappte) Antwortzeit fest', () => {
    const first = schedule(null, 3, NOW)
    expect(reviewLogEntry('c1', 0, null, first, 3, NOW - 5000)).toEqual({
      cardId: 'c1',
      side: 0,
      rating: 3,
      phase: 'new',
      intervalBefore: 0,
      intervalAfter: (10 * MINUTE) / DAY,
      durationMs: 5000,
      reviewedAt: NOW,
    })
    const later = NOW + DAY
    const graduated = schedule({ ...first, phase: 'review', interval: 3, due: NOW + 3 * DAY }, 1, later)
    const e = reviewLogEntry('c1', 0, { ...first, phase: 'review', interval: 3, due: NOW + 3 * DAY }, graduated, 1, later - 10 * MINUTE)
    expect(e).toMatchObject({ phase: 'review', intervalBefore: 3, durationMs: 120_000 })
  })
})

describe('Auswertung', () => {
  const row = (reviewedAt: number, rating: number, phase = 'review', deckId: string | null = 'd1'): LogRow => ({
    reviewedAt,
    rating,
    phase,
    deckId,
    durationMs: 4000,
  })

  it('zählt je Tag und – für die letzten 30 Tage – je Stapel mit Trefferquote gelernter Karten', () => {
    const dayOf = (t: number) => dayKey(new Date(t))
    const { days, decks } = aggregateLog(
      [
        row(NOW - 40 * DAY, 3),
        row(NOW - DAY, 1),
        row(NOW, 1),
        row(NOW + 1000, 3),
        row(NOW + 2000, 4, 'new'),
        row(NOW + 3000, 3, 'review', 'd2'),
        row(NOW + 4000, 3, 'review', null),
      ],
      dayOf,
      NOW - 30 * DAY,
    )
    expect(days.map((d) => [d.date, d.reviews, d.again])).toEqual([
      ['2026-09-04', 1, 0],
      ['2026-10-13', 1, 1],
      ['2026-10-14', 5, 1],
    ])
    expect(days[2].ms).toBe(20_000)
    expect(decks).toEqual([
      { deckId: 'd1', reviews: 4, ms: 16_000, matureReviews: 3, matureCorrect: 1 },
      { deckId: 'd2', reviews: 1, ms: 4000, matureReviews: 1, matureCorrect: 1 },
    ])
  })

  it('Serie: Tage am Stück bis heute oder gestern, dazu die längste', () => {
    const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-12', '2026-10-13']
    expect(streaks(days, '2026-10-13')).toEqual({ current: 2, longest: 4 })
    expect(streaks(days, '2026-10-14')).toEqual({ current: 2, longest: 4 })
    expect(streaks(days, '2026-10-15')).toEqual({ current: 0, longest: 4 })
    expect(streaks([], '2026-10-15')).toEqual({ current: 0, longest: 0 })
    // Monats- und Jahreswechsel
    expect(streaks(['2025-12-31', '2026-01-01'], '2026-01-01').current).toBe(2)
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('Vorschau: fällige Kartenseiten je Tag, Überfälliges heute, ohne neue und ausgesetzte Karten', () => {
    const cards = [card('a'), card('b', { type: 'reversed' }), card('c'), card('d', { suspended: true }), card('e')]
    const at = (cardId: string, side: 0 | 1, due: number): CardReview => ({ cardId, side, ...schedule(null, 4, NOW - 10 * DAY), due })
    const states = stateMap([
      at('a', 0, NOW - 3 * DAY),
      at('b', 0, NOW + 2 * 60 * MINUTE),
      at('b', 1, NOW + DAY),
      at('c', 0, NOW + 6 * DAY),
      at('d', 0, NOW),
    ])
    expect(dueForecast(cards, states, NOW, 7)).toEqual([2, 1, 0, 0, 0, 0, 1])
    expect(dueForecast(cards, states, NOW, 3)).toEqual([2, 1, 0])
  })
})
