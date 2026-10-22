// FSRS-Gewichte aus dem eigenen Lernverlauf schätzen – wie der Optimierer von Anki (fsrs-rs v2.0.4), in reinem
// TypeScript: Vortraining der Anfangsstabilitäten, dann Training aller 19 Gewichte mit Adam. Die Gradienten werden
// numerisch bestimmt (zentrale Differenzen) – so gibt es die Formeln nur einmal, in fsrs.ts.
// https://github.com/open-spaced-repetition/fsrs-rs/blob/v2.0.4/src/pre_training.rs
// https://github.com/open-spaced-repetition/fsrs-rs/blob/v2.0.4/src/training.rs
// https://github.com/open-spaced-repetition/fsrs-rs/blob/v2.0.4/src/inference.rs
import { DEFAULT_WEIGHTS, clipWeights, initialMemory, nextMemory, retrievability } from './fsrs'
import { trainingData, type FsrsSequence, type PretrainEntry, type WeightedSequence } from './fsrs-dataset'
import { shuffle } from './study'
import type { FsrsMetrics } from './types'

const S_MIN = 0.01
const INIT_S_MAX = 100
/** Streuung der Gewichte (fsrs-rs: PARAMS_STDDEV) – für die Regularisierung zu den Startgewichten */
const PARAMS_STDDEV = [
  6.61, 9.52, 17.69, 27.74, 0.55, 0.28, 0.67, 0.12, 0.4, 0.18, 0.34, 0.27, 0.08, 0.14, 0.57, 0.25, 1.03, 0.27, 0.39,
]
const EPOCHS = 5
const BATCH_TARGETS = 512
const LEARNING_RATE = 0.04
const GAMMA = 1
const SEED = 2023

/** Zufallszahlen in [0, 1) mit festem Startwert (Park–Miller) – gleiche Daten ergeben gleiche Gewichte */
function seededRandom(seed: number) {
  let state = seed % 2147483647 || 1
  return () => (state = (state * 16807) % 2147483647) / 2147483647
}

const bce = (p: number, y: number) => -(y * Math.log(p) + (1 - y) * Math.log(1 - p))

// ---------------------------------------------------------------------------
// Vortraining der Anfangsstabilitäten w0–w3
// ---------------------------------------------------------------------------

type RecallPoint = { delta: number; recall: number; count: number }

/** Verlust einer Anfangsstabilität `s` für die erste Bewertung: Vorhersagefehler plus Abstand zum Standardwert */
export function pretrainLoss(points: RecallPoint[], s: number, defaultS: number): number {
  let loss = 0
  for (const { delta, recall, count } of points) {
    const r = retrievability(delta, s)
    loss += count * -(recall * Math.log(r) + (1 - recall) * Math.log(1 - r))
  }
  return loss + Math.abs(s - defaultS) / 16
}

/** Beste Anfangsstabilität per ternärer Suche – Erinnerungsquoten mit Laplace-Glättung zum Durchschnitt hin */
export function searchStability(points: RecallPoint[], averageRecall: number, defaultS: number): number {
  const smoothed = points.map((p) => ({ ...p, recall: (p.recall * p.count + averageRecall) / (p.count + 1) }))
  let lo = S_MIN
  let hi = INIT_S_MAX
  for (let i = 0; hi - lo > Number.EPSILON && i < 1000; i++) {
    const m1 = lo + (hi - lo) / 3
    const m2 = hi - (hi - lo) / 3
    if (pretrainLoss(smoothed, m1, defaultS) < pretrainLoss(smoothed, m2, defaultS)) hi = m2
    else lo = m1
  }
  return (lo + hi) / 2
}

type Ratings = Partial<Record<1 | 2 | 3 | 4, number>>

/**
 * Anfangsstabilitäten in eine sinnvolle Reihenfolge bringen (bessere Bewertung, stabiler) und fehlende aus den
 * vorhandenen ableiten – wie smooth_and_fill in fsrs-rs. `counts`: Datenmenge je erster Bewertung.
 */
export function smoothAndFill(stabilities: Ratings, counts: Ratings): [number, number, number, number] {
  const s: Ratings = {}
  for (const r of [1, 2, 3, 4] as const) if (stabilities[r] !== undefined && counts[r] !== undefined) s[r] = stabilities[r]
  for (const [small, big] of [
    [1, 2],
    [2, 3],
    [3, 4],
    [1, 3],
    [2, 4],
    [1, 4],
  ] as const) {
    const a = s[small]
    const b = s[big]
    if (a === undefined || b === undefined || a <= b) continue
    // Die Bewertung mit weniger Daten übernimmt den Wert der anderen
    if (counts[small]! > counts[big]!) s[big] = a
    else s[small] = b
  }
  const known = ([1, 2, 3, 4] as const).filter((r) => s[r] !== undefined)
  if (known.length === 0) throw new Error('Keine Daten für die Anfangsstabilität.')
  let [r1, r2, r3, r4] = [s[1], s[2], s[3], s[4]]
  const w1 = 0.41
  const w2 = 0.54
  if (known.length === 1) {
    const k = known[0]
    const factor = s[k]! / DEFAULT_WEIGHTS[k - 1]
    ;[r1, r2, r3, r4] = DEFAULT_WEIGHTS.slice(0, 4).map((d) => d * factor)
  } else if (known.length === 2) {
    // Aus ln s2 = 0,41·ln s1 + 0,59·ln s3 und ln s3 = 0,46·ln s2 + 0,54·ln s4 aufgelöst
    if (r3 !== undefined && r4 !== undefined) {
      r2 = r3 ** (1 / (1 - w2)) * r4 ** (1 - 1 / (1 - w2))
      r1 = r2 ** (1 / w1) * r3 ** (1 - 1 / w1)
    } else if (r2 !== undefined && r4 !== undefined) {
      r3 = r2 ** (1 - w2) * r4 ** w2
      r1 = r2 ** (1 / w1) * r3 ** (1 - 1 / w1)
    } else if (r2 !== undefined && r3 !== undefined) {
      r4 = r2 ** (1 - 1 / w2) * r3 ** (1 / w2)
      r1 = r2 ** (1 / w1) * r3 ** (1 - 1 / w1)
    } else if (r1 !== undefined && r4 !== undefined) {
      const e = w1 / (w1 + w2 - w1 * w2)
      const f = w2 / (w1 + w2 - w1 * w2)
      r2 = r1 ** e * r4 ** (1 - e)
      r3 = r1 ** (1 - f) * r4 ** f
    } else if (r1 !== undefined && r3 !== undefined) {
      r2 = r1 ** w1 * r3 ** (1 - w1)
      r4 = r2 ** (1 - 1 / w2) * r3 ** (1 / w2)
    } else if (r1 !== undefined && r2 !== undefined) {
      r3 = r1 ** (1 - 1 / (1 - w1)) * r2 ** (1 / (1 - w1))
      r4 = r2 ** (1 - 1 / w2) * r3 ** (1 / w2)
    }
  } else if (known.length === 3) {
    if (r1 === undefined) r1 = r2! ** (1 / w1) * r3! ** (1 - 1 / w1)
    else if (r2 === undefined) r2 = r1 ** w1 * r3! ** (1 - w1)
    else if (r3 === undefined) r3 = r2 ** (1 - w2) * r4! ** w2
    else r4 = r2 ** (1 - 1 / w2) * r3 ** (1 / w2)
  }
  const clamp = (v: number) => Math.min(INIT_S_MAX, Math.max(S_MIN, v))
  return [clamp(r1!), clamp(r2!), clamp(r3!), clamp(r4!)]
}

/** Anfangsstabilitäten aus den Vortrainings-Einträgen – und wie viele Daten es je erster Bewertung gab */
function pretrain(entries: PretrainEntry[], averageRecall: number) {
  const stabilities: Ratings = {}
  const counts: Ratings = {}
  for (const rating of [1, 2, 3, 4] as const) {
    const byDelta = new Map<number, { sum: number; count: number }>()
    for (const e of entries) {
      if (e.rating !== rating) continue
      const g = byDelta.get(e.delta) ?? { sum: 0, count: 0 }
      g.sum += e.y
      g.count += 1
      byDelta.set(e.delta, g)
    }
    if (byDelta.size === 0) continue
    const points = [...byDelta]
      .sort((a, b) => a[0] - b[0])
      .map(([delta, g]) => ({ delta, recall: g.sum / g.count, count: g.count }))
    stabilities[rating] = searchStability(points, averageRecall, DEFAULT_WEIGHTS[rating - 1])
    counts[rating] = points.reduce((sum, p) => sum + p.count, 0)
  }
  return { initial: smoothAndFill(stabilities, counts), counts }
}

// ---------------------------------------------------------------------------
// Vorhersage und Verlust
// ---------------------------------------------------------------------------

/** Erinnerungswahrscheinlichkeit an jedem Ziel der Folge – mit dem Modell aus fsrs.ts und ganzen Tagen */
function predict(seq: WeightedSequence, w: readonly number[], visit: (p: number, target: number) => void) {
  const last = seq.targets.at(-1)?.index ?? 0
  let memory = initialMemory(seq.ratings[0], w)
  let t = 0
  for (let i = 1; i <= last; i++) {
    if (seq.targets[t]?.index === i) visit(retrievability(seq.days[i], memory.stability), t++)
    memory = nextMemory(memory, seq.ratings[i], seq.days[i], w)
  }
}

function sequenceLoss(seq: WeightedSequence, w: readonly number[]): number {
  let loss = 0
  predict(seq, w, (p, t) => {
    const { y, weight } = seq.targets[t]
    loss += weight * bce(p, y)
  })
  return loss
}

type Batch = { sequences: WeightedSequence[]; size: number }

/** Folgen nach Länge sortiert bündeln, bis ein Batch mindestens 512 Ziele hat – eine Folge wird nie geteilt */
function makeBatches(sequences: WeightedSequence[]): Batch[] {
  const sorted = sequences.filter((s) => s.targets.length > 0).sort((a, b) => a.targets.at(-1)!.index - b.targets.at(-1)!.index)
  const batches: Batch[] = []
  let current: Batch = { sequences: [], size: 0 }
  for (const seq of sorted) {
    current.sequences.push(seq)
    current.size += seq.targets.length
    if (current.size >= BATCH_TARGETS) {
      batches.push(current)
      current = { sequences: [], size: 0 }
    }
  }
  if (current.size > 0) batches.push(current)
  return batches
}

/** Verlust eines Batches: gewichtete Kreuzentropie plus Regularisierung zu den Startgewichten */
function batchLoss(batch: Batch, w: readonly number[], init: readonly number[], total: number): number {
  let loss = 0
  for (const seq of batch.sequences) loss += sequenceLoss(seq, w)
  let penalty = 0
  for (let j = 0; j < w.length; j++) penalty += (w[j] - init[j]) ** 2 / PARAMS_STDDEV[j] ** 2
  return loss + GAMMA * (batch.size / total) * penalty
}

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------

async function train(
  sequences: WeightedSequence[],
  init: readonly number[],
  opts: { pause: () => Promise<void> | void; seed: number },
): Promise<number[]> {
  const batches = makeBatches(sequences)
  const total = batches.reduce((sum, b) => sum + b.size, 0)
  const random = seededRandom(opts.seed)
  const steps = batches.length * EPOCHS
  const [beta1, beta2, eps] = [0.9, 0.999, 1e-8]
  const m = new Array<number>(init.length).fill(0)
  const v = new Array<number>(init.length).fill(0)
  let w = [...init]
  let best = { loss: Infinity, w }
  let k = 0
  for (let epoch = 0; epoch < EPOCHS; epoch++) {
    for (const batch of shuffle(batches, random)) {
      // Gradient numerisch: Verlust etwas über und unter jedem Gewicht
      const grad = w.map((wj, j) => {
        const h = 1e-5 * Math.max(1, Math.abs(wj))
        const up = [...w]
        const down = [...w]
        up[j] += h
        down[j] -= h
        return (batchLoss(batch, up, init, total) - batchLoss(batch, down, init, total)) / (2 * h)
      })
      // Adam mit Lernrate nach Kosinus-Abklingen
      const lr = (LEARNING_RATE * (1 + Math.cos((Math.PI * k) / steps))) / 2
      k++
      w = clipWeights(
        w.map((wj, j) => {
          m[j] = beta1 * m[j] + (1 - beta1) * grad[j]
          v[j] = beta2 * v[j] + (1 - beta2) * grad[j] ** 2
          const mHat = m[j] / (1 - beta1 ** k)
          const vHat = v[j] / (1 - beta2 ** k)
          return wj - (lr * mHat) / (Math.sqrt(vHat) + eps)
        }),
      )
      await opts.pause()
    }
    // Den besten Stand behalten – gemessen wie fsrs-rs auf den Trainingsdaten
    const loss = batches.reduce((sum, b) => sum + batchLoss(b, w, init, total), 0) / total
    if (loss < best.loss) best = { loss, w }
  }
  return best.w
}

type OptimizeOutcome =
  | { status: 'not_enough'; reviews: number }
  | { status: 'done'; reviews: number; weights: number[] }

/**
 * Gewichte für die Folgen schätzen. Unter 8 auswertbaren Wiederholungen gibt es kein Ergebnis, unter 64 (oder nur je
 * eine Langzeit-Wiederholung) nur die Anfangsstabilitäten w0–w3. `pause` wird nach jedem Batch abgewartet – auf dem
 * Server, damit andere Anfragen dazwischen drankommen.
 */
export async function optimizeFsrs(
  sequences: FsrsSequence[],
  opts: { pause?: () => Promise<void> | void; seed?: number } = {},
): Promise<OptimizeOutcome> {
  const data = trainingData(sequences)
  if (data.reviews < 8) return { status: 'not_enough', reviews: data.reviews }
  const { initial, counts } = pretrain(data.pretrain, data.averageRecall)
  const init = [...initial, ...DEFAULT_WEIGHTS.slice(4)]
  if (data.reviews < 64 || data.onlyFirst) return { status: 'done', reviews: data.reviews, weights: init }
  const trained = await train(data.train, init, { pause: opts.pause ?? (() => {}), seed: opts.seed ?? SEED })
  const s0 = smoothAndFill({ 1: trained[0], 2: trained[1], 3: trained[2], 4: trained[3] }, counts)
  const weights = [...s0, ...trained.slice(4)]
  if (!weights.every(Number.isFinite)) throw new Error('Die Optimierung ergab ungültige Gewichte.')
  return { status: 'done', reviews: data.reviews, weights }
}

// ---------------------------------------------------------------------------
// Bewertung
// ---------------------------------------------------------------------------

const bin = (base: number, scale: number, x: number) => Math.round(scale * base ** Math.floor(Math.log(x) / Math.log(base)))

/** Fach eines Abstands für RMSE(bins), z. B. 1 Tag → 248, 4 Tage → 898 */
export const deltaBin = (days: number) => bin(3.62, 248, days)

/**
 * Wie gut die Gewichte die Wiederholungen vorhersagen: Log-Loss und RMSE(bins) wie `evaluate` in fsrs-rs – Fächer nach
 * Abstand, Zahl der Langzeit-Wiederholungen und Zahl der Vergessen davor.
 */
export function evaluateWeights(sequences: WeightedSequence[], w: readonly number[]): FsrsMetrics {
  let loss = 0
  let weightSum = 0
  const bins = new Map<string, { predicted: number; actual: number; count: number; weight: number }>()
  for (const seq of sequences) {
    let longTerm = 0
    let lapses = 0
    let next = 1
    predict(seq, w, (p, t) => {
      const { index, y, weight } = seq.targets[t]
      // Langzeit-Wiederholungen und Vergessen davor zählen
      for (; next < index; next++) {
        if (seq.days[next] > 0) {
          longTerm++
          if (seq.ratings[next] === 1) lapses++
        }
      }
      loss += weight * bce(p, y)
      weightSum += weight
      const length = bin(1.89, 1.99, longTerm + 2)
      const key = `${deltaBin(seq.days[index])}:${length}:${lapses ? bin(1.73, 1.65, lapses) : 0}`
      const b = bins.get(key) ?? { predicted: 0, actual: 0, count: 0, weight: 0 }
      b.predicted += p
      b.actual += y
      b.count += 1
      b.weight += weight
      bins.set(key, b)
    })
  }
  let squared = 0
  let binWeight = 0
  for (const b of bins.values()) {
    squared += (b.predicted / b.count - b.actual / b.count) ** 2 * b.weight
    binWeight += b.weight
  }
  return { logLoss: weightSum ? loss / weightSum : 0, rmse: binWeight ? Math.sqrt(squared / binWeight) : 0 }
}
