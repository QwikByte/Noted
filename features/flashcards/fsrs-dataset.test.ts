import { describe, expect, it } from 'vitest'
import { buildSequences, evaluationData, trainingData, type FsrsSequence } from './fsrs-dataset'
import { daysBetween } from '@/features/calendar/dates'
import type { ReviewLogEntry } from './types'

type Row = Pick<ReviewLogEntry, 'cardId' | 'side' | 'rating' | 'phase' | 'reviewedAt'>

/** Tagesnummer in Ortszeit Europe/Berlin – wie auf dem Server */
const berlin = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' })
const dayOf = (t: number) => daysBetween('1970-01-01', berlin.format(new Date(t)))
const at = (iso: string) => new Date(`${iso}+02:00`).getTime()
const row = (rating: number, phase: Row['phase'], iso: string, side = 0, cardId = 'k'): Row => ({
  cardId,
  side,
  rating: rating as Row['rating'],
  phase,
  reviewedAt: at(iso),
})

/** Folge aus (Bewertung, Tage seit der vorigen) – Zeitpunkt je Tag fortlaufend */
function seq(steps: [number, number][], start = 0): FsrsSequence {
  let day = start
  return {
    ratings: steps.map(([r]) => r),
    days: steps.map(([, d], i) => (i === 0 ? 0 : d)),
    times: steps.map(([, d], i) => {
      if (i > 0) day += d
      return day * 86_400_000 + i
    }),
  }
}

describe('FSRS-Optimierung: Daten aus dem Protokoll', () => {
  it('baut Folgen in ganzen Kalendertagen – Lernschritte am selben Tag bleiben mit Abstand 0', () => {
    // Mo 10:00, Mo 10:10, Di 09:00, Fr 18:00, Fr 18:10, So 12:00
    const rows = [
      row(3, 'new', '2026-10-12T10:00:00'),
      row(3, 'learning', '2026-10-12T10:10:00'),
      row(3, 'review', '2026-10-13T09:00:00'),
      row(1, 'review', '2026-10-16T18:00:00'),
      row(3, 'relearning', '2026-10-16T18:10:00'),
      row(3, 'review', '2026-10-18T12:00:00'),
    ]
    const [s] = buildSequences([...rows].reverse(), dayOf)
    expect(s.ratings).toEqual([3, 3, 3, 1, 3, 3])
    expect(s.days).toEqual([0, 0, 1, 3, 0, 2])
    const data = evaluationData([s])
    expect(data[0].targets.map((t) => [t.index, t.y])).toEqual([
      [2, 1],
      [3, 0],
      [5, 1],
    ])
    // Eine einzelne Folge wäre für den Ausreißer-Filter zu selten – daher mehrfach
    expect(trainingData(Array(25).fill(s)).pretrain[0]).toEqual({ rating: 3, delta: 1, y: 1 })
  })

  it('zählt Tage über Mitternacht und die Zeitumstellung', () => {
    const night = buildSequences([row(3, 'new', '2026-10-12T23:50:00'), row(3, 'review', '2026-10-13T00:10:00')], dayOf)
    expect(night[0].days).toEqual([0, 1])
    // 29.03.2026: Sommerzeit beginnt – der Tag hat nur 23 Stunden
    const dst = buildSequences(
      [
        { cardId: 'k', side: 0, rating: 3, phase: 'new', reviewedAt: new Date('2026-03-28T12:00:00+01:00').getTime() },
        { cardId: 'k', side: 0, rating: 3, phase: 'review', reviewedAt: new Date('2026-03-29T12:00:00+02:00').getTime() },
      ],
      dayOf,
    )
    expect(dst[0].days).toEqual([0, 1])
  })

  it('verwirft Folgen ohne Anfang und beginnt nach „Neu lernen“ neu', () => {
    expect(buildSequences([row(3, 'review', '2026-10-12T10:00:00'), row(3, 'review', '2026-10-14T10:00:00')], dayOf)).toEqual([])
    const relearned = buildSequences(
      [
        row(3, 'new', '2026-10-01T10:00:00'),
        row(1, 'review', '2026-10-05T10:00:00'),
        row(4, 'new', '2026-10-06T10:00:00'),
        row(3, 'review', '2026-10-10T10:00:00'),
      ],
      dayOf,
    )
    expect(relearned).toHaveLength(1)
    expect(relearned[0].ratings).toEqual([4, 3])
    expect(relearned[0].days).toEqual([0, 4])
  })

  it('trennt die Seiten einer Karte und verwirft Folgen ganz an einem Tag', () => {
    const rows = [
      row(3, 'new', '2026-10-12T10:00:00', 0),
      row(3, 'review', '2026-10-14T10:00:00', 0),
      row(2, 'new', '2026-10-12T10:00:00', 1),
      row(3, 'review', '2026-10-15T10:00:00', 1),
      row(3, 'new', '2026-10-12T10:00:00', 0, 'heute'),
      row(3, 'learning', '2026-10-12T10:10:00', 0, 'heute'),
    ]
    const sequences = buildSequences(rows, dayOf)
    expect(sequences.map((s) => s.ratings).sort()).toEqual([
      [2, 3],
      [3, 3],
    ])
  })

  it('entfernt Ausreißer aus Vortraining und Training', () => {
    const sequences = [
      ...Array.from({ length: 30 }, (_, i) => seq([[3, 0], [3, 1], [3, 5]], i)),
      ...Array.from({ length: 5 }, (_, i) => seq([[3, 0], [3, 2], [3, 5]], i)),
      seq([[3, 0], [3, 150], [1, 30]]),
    ]
    const data = trainingData(sequences)
    expect(new Set(data.pretrain.map((e) => e.delta))).toEqual(new Set([1]))
    expect(data.pretrain).toHaveLength(30)
    // Auch die späteren Wiederholungen dieser Folgen fehlen im Training
    expect(data.train).toHaveLength(30)
    expect(data.reviews).toBe(60)

    const long = trainingData([
      ...Array.from({ length: 25 }, () => seq([[4, 0], [3, 200]])),
      ...Array.from({ length: 25 }, () => seq([[3, 0], [3, 200]])),
    ])
    expect(long.pretrain.map((e) => e.rating)).toEqual(Array(25).fill(4))
  })

  it('gewichtet nach Alter und begrenzt die Länge nur im Training', () => {
    const steps: [number, number][] = [[3, 0], ...Array.from({ length: 70 }, () => [3, 2] as [number, number])]
    const sequences = [seq(steps), ...Array.from({ length: 30 }, (_, i) => seq([[3, 0], [3, 2]], 200 + i))]
    const evaluation = evaluationData(sequences)
    const weights = evaluation.flatMap((s) => s.targets.map((t) => t.weight))
    expect(Math.min(...weights)).toBeCloseTo(0.25, 6)
    expect(Math.max(...weights)).toBeCloseTo(1, 6)
    // Die älteste Wiederholung ist die erste der langen Folge
    expect(evaluation[0].targets[0].weight).toBeCloseTo(0.25, 6)
    expect(evaluation[0].targets).toHaveLength(70)
    const train = trainingData(sequences).train
    expect(train[0].targets.at(-1)!.index).toBe(63)
    expect(trainingData(sequences).reviews).toBe(100)
  })
})
