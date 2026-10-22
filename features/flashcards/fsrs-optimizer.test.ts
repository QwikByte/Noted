import { describe, expect, it } from 'vitest'
import { DEFAULT_WEIGHTS, fsrsInterval, initialMemory, nextMemory, retrievability, type Memory } from './fsrs'
import { deltaBin, evaluateWeights, optimizeFsrs, pretrainLoss, searchStability, smoothAndFill } from './fsrs-optimizer'
import { evaluationData, type FsrsSequence } from './fsrs-dataset'

function random(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647
}

const DAY = 86_400_000

/**
 * Lernverlauf wie im Lernmodus, erzeugt mit bekannten Gewichten: erste Bewertung mit Lernschritten am selben Tag, dann
 * Wiederholungen bei 90 % Behaltensrate bis Tag 365 – erinnert mit Wahrscheinlichkeit R
 */
function simulate(w: readonly number[], sides: number, seed: number): FsrsSequence[] {
  const rnd = random(seed)
  const pick = <T,>(options: [T, number][]) => {
    let x = rnd()
    for (const [value, p] of options) if ((x -= p) < 0) return value
    return options[options.length - 1][0]
  }
  const sequences: FsrsSequence[] = []
  for (let n = 0; n < sides; n++) {
    let day = Math.floor(rnd() * 30)
    const ratings: number[] = []
    const days: number[] = []
    const times: number[] = []
    let memory: Memory | null = null
    const review = (rating: number, delta: number) => {
      memory = memory ? nextMemory(memory, rating, delta, w) : initialMemory(rating, w)
      ratings.push(rating)
      days.push(delta)
      times.push(day * DAY + ratings.length)
    }
    const first = pick([
      [1, 0.15],
      [2, 0.1],
      [3, 0.6],
      [4, 0.15],
    ])
    review(first, 0)
    // Lernschritte wie in srs.ts: 1 und 10 Minuten, „Gut“ im letzten Schritt schließt ab
    if (first === 1 || first === 2) review(3, 0)
    if (first !== 4) review(3, 0)
    for (;;) {
      const m: Memory = memory!
      const delta = Math.max(1, Math.round(fsrsInterval(m.stability, 0.9) * (0.8 + 0.4 * rnd())))
      if (day + delta > 365) break
      day += delta
      if (rnd() < retrievability(delta, m.stability)) {
        review(
          pick([
            [3, 0.8],
            [2, 0.1],
            [4, 0.1],
          ]),
          delta,
        )
      } else {
        review(1, delta)
        review(3, 0)
      }
    }
    sequences.push({ ratings, days, times })
  }
  return sequences
}

describe('FSRS-Optimierung: Vortraining (Testwerte aus fsrs-rs v2.0.4)', () => {
  const deltas = [1, 2, 3, 4, 5]

  it('berechnet den Verlust einer Anfangsstabilität', () => {
    const recall = [0.86684181, 0.90758192, 0.73348482, 0.76776996, 0.68769064]
    const count = [435, 97, 63, 38, 28]
    const points = deltas.map((delta, i) => ({ delta, recall: recall[i], count: count[i] }))
    expect(pretrainLoss(points, 1.017056, DEFAULT_WEIGHTS[0])).toBeCloseTo(280.75007086903867, 6)
    expect(pretrainLoss(points, 1.017011, DEFAULT_WEIGHTS[0])).toBeCloseTo(280.74973684868695, 6)
  })

  it('sucht die beste Anfangsstabilität', () => {
    const recall = [0.86666667, 0.90721649, 0.73015873, 0.76315789, 0.67857143]
    const count = [435, 97, 63, 38, 28]
    const points = deltas.map((delta, i) => ({ delta, recall: recall[i], count: count[i] }))
    expect(searchStability(points, 0.94302857, DEFAULT_WEIGHTS[0])).toBeCloseTo(0.908688, 5)
  })

  it('ordnet die Anfangsstabilitäten und ergänzt fehlende', () => {
    const all = { 1: 1, 2: 1, 3: 1, 4: 1 }
    const a = smoothAndFill({ 1: 0.4, 3: 2.3, 4: 10.9 }, all)
    ;[0.4, 1.1227008, 2.3, 10.9].forEach((v, i) => expect(a[i]).toBeCloseTo(v, 5))
    const b = smoothAndFill({ 2: 0.35 }, { 2: 1 })
    ;[0.11901211, 0.35, 0.9380833, 4.638989].forEach((v, i) => expect(b[i]).toBeCloseTo(v, 5))
    // Eine schlechtere Bewertung ist nie stabiler – die mit weniger Daten übernimmt den Wert der anderen
    expect(smoothAndFill({ 1: 5, 2: 3, 3: 8, 4: 20 }, { 1: 1, 2: 50, 3: 50, 4: 50 })[0]).toBe(3)
  })

  it('teilt Abstände in Fächer für RMSE(bins)', () => {
    expect(deltaBin(1)).toBe(248)
    expect(deltaBin(4)).toBe(898)
  })
})

describe('FSRS-Optimierung: Training', () => {
  const truth = [...DEFAULT_WEIGHTS]
  ;[truth[0], truth[1], truth[2], truth[3]] = [0.6, 1.5, 4.5, 20]
  truth[8] = 1.3
  truth[11] = 1.6

  it('findet die Gewichte synthetischer Daten wieder – gleich bei gleichen Daten', async () => {
    const sequences = simulate(truth, 2000, 7)
    let pauses = 0
    const result = await optimizeFsrs(sequences, { pause: () => void pauses++ })
    expect(result.status).toBe('done')
    if (result.status !== 'done') return
    const data = evaluationData(sequences)
    const optimized = evaluateWeights(data, result.weights)
    const standard = evaluateWeights(data, DEFAULT_WEIGHTS)
    const best = evaluateWeights(data, truth)
    expect(optimized.logLoss).toBeLessThan(standard.logLoss)
    expect(optimized.logLoss).toBeLessThanOrEqual(best.logLoss + 0.005)
    expect(optimized.rmse).toBeLessThan(standard.rmse)
    // w2 allein lässt sich aus solchen Daten nicht bestimmen: Nach „Gut“ folgt am selben Tag noch ein Lernschritt,
    // dessen Kurzzeitformel die Stabilität mit e^(w17·w18) multipliziert. Bestimmt ist die Stabilität danach
    const afterStep = (w: readonly number[]) => w[2] * Math.exp(w[17] * w[18])
    expect(afterStep(result.weights)).toBeGreaterThan(afterStep(truth) * 0.75)
    expect(afterStep(result.weights)).toBeLessThan(afterStep(truth) * 1.25)
    // Nach jedem Batch abgegeben: gut 13 000 Wiederholungen ergeben über 20 Batches, 5 Epochen
    expect(pauses).toBeGreaterThanOrEqual(5 * 20)
    const again = await optimizeFsrs(sequences)
    expect(again).toEqual(result)
  }, 60_000)

  it('braucht mindestens 8 Wiederholungen – unter 64 nur die Anfangsstabilitäten', async () => {
    const few = Array.from({ length: 7 }, (_, i): FsrsSequence => ({ ratings: [3, 3], days: [0, 3], times: [i, DAY * 3 + i] }))
    // Gezählt wird nach dem Ausreißer-Filter – der entfernt je erster Bewertung mindestens 20 Folgen
    expect(await optimizeFsrs(few)).toEqual({ status: 'not_enough', reviews: 0 })
    const some = Array.from({ length: 30 }, (_, i): FsrsSequence => ({
      ratings: [3, i % 4 ? 3 : 1],
      days: [0, 3],
      times: [i, DAY * 3 + i],
    }))
    const result = await optimizeFsrs(some)
    expect(result.status).toBe('done')
    if (result.status !== 'done') return
    expect(result.reviews).toBe(30)
    expect(result.weights.slice(4)).toEqual(DEFAULT_WEIGHTS.slice(4))
    expect(result.weights.slice(0, 4)).not.toEqual(DEFAULT_WEIGHTS.slice(0, 4))
  })
})
