// Aufbereitung des Bewertungsprotokolls für die Optimierung der FSRS-Gewichte (fsrs-optimizer.ts) – wie fsrs-rs
// v2.0.4 (dataset.rs) und Anki 25.02 (rslib/src/scheduler/fsrs/params.rs):
// https://github.com/open-spaced-repetition/fsrs-rs/blob/v2.0.4/src/dataset.rs
// https://github.com/ankitects/anki/blob/25.02/rslib/src/scheduler/fsrs/params.rs
import { reviewKey } from './study'
import type { ReviewLogEntry } from './types'

/** Verlauf einer Kartenseite ab ihrer (letzten) ersten Abfrage – `days[i]`: ganze Kalendertage seit Bewertung i−1 */
export type FsrsSequence = { ratings: number[]; days: number[]; times: number[] }

/** Wiederholung, deren Ergebnis vorhergesagt wird – `index` in der Folge, `weight` je nach Alter (0,25 bis 1) */
export type FsrsTarget = { index: number; y: 0 | 1; weight: number }

export type WeightedSequence = { ratings: number[]; days: number[]; targets: FsrsTarget[] }

/** Für das Vortraining der Anfangsstabilitäten: erste Bewertung, Tage bis zur ersten Langzeit-Wiederholung, Ergebnis */
export type PretrainEntry = { rating: number; delta: number; y: 0 | 1 }

/** Längste Folge im Training (fsrs-rs: max_seq_len) */
const MAX_SEQ_LEN = 64

type Row = Pick<ReviewLogEntry, 'cardId' | 'side' | 'rating' | 'phase' | 'reviewedAt'>

/**
 * Folgen je Kartenseite: nach Zeit sortiert, ab dem letzten 'new' (nach „Neu lernen“ beginnt sie neu). Folgen ohne
 * 'new' fehlt der Anfang, Folgen ganz an einem Tag haben nichts vorherzusagen – beide entfallen. `dayOf`: Tagesnummer
 * in Ortszeit.
 */
export function buildSequences(rows: Row[], dayOf: (t: number) => number): FsrsSequence[] {
  const groups = new Map<string, Row[]>()
  for (const row of rows) {
    const key = reviewKey(row.cardId, row.side)
    const list = groups.get(key)
    if (list) list.push(row)
    else groups.set(key, [row])
  }
  const sequences: FsrsSequence[] = []
  for (const list of groups.values()) {
    list.sort((a, b) => a.reviewedAt - b.reviewedAt)
    const start = list.findLastIndex((r) => r.phase === 'new')
    if (start < 0) continue
    const part = list.slice(start)
    const dayNumbers = part.map((r) => dayOf(r.reviewedAt))
    const days = dayNumbers.map((d, i) => (i === 0 ? 0 : d - dayNumbers[i - 1]))
    if (!days.some((d) => d > 0)) continue
    sequences.push({ ratings: part.map((r) => r.rating), days, times: part.map((r) => r.reviewedAt) })
  }
  return sequences
}

/** Auswertbare Wiederholungen einer Folge: alle ab der zweiten Bewertung mit mindestens einem Tag Abstand */
const evaluable = (seq: FsrsSequence) => seq.days.flatMap((d, i) => (i > 0 && d > 0 ? [i] : []))

/** Zeitgewichte: die älteste Wiederholung zählt 0,25, die neueste 1 */
function weighByAge(items: { seq: number; index: number; time: number }[]): Map<string, number> {
  const sorted = [...items].sort((a, b) => a.time - b.time)
  const last = Math.max(sorted.length - 1, 1)
  return new Map(sorted.map((it, k) => [`${it.seq}:${it.index}`, 0.25 + 0.75 * (k / last) ** 3]))
}

function weighted(sequences: FsrsSequence[], maxIndex = Infinity): WeightedSequence[] {
  const items = sequences.flatMap((seq, s) => evaluable(seq).map((index) => ({ seq: s, index, time: seq.times[index] })))
  const weights = weighByAge(items)
  return sequences.map((seq, s) => ({
    ratings: seq.ratings,
    days: seq.days,
    targets: evaluable(seq)
      .filter((index) => index < maxIndex)
      .map((index) => ({ index, y: seq.ratings[index] > 1 ? 1 : 0, weight: weights.get(`${s}:${index}`)! })),
  }))
}

/**
 * Ausreißer wie filter_outlier in fsrs-rs: Je erster Bewertung werden die seltensten Abstände bis zur ersten
 * Langzeit-Wiederholung entfernt (zusammen 5 %, mindestens 20 Einträge), außerdem kleine Gruppen (unter 6) und sehr
 * lange Abstände. Liefert die entfernten Paare als „Bewertung:Abstand“.
 */
function outliers(entries: PretrainEntry[]): Set<string> {
  const removed = new Set<string>()
  for (const rating of [1, 2, 3, 4]) {
    const byDelta = new Map<number, number>()
    for (const e of entries) if (e.rating === rating) byDelta.set(e.delta, (byDelta.get(e.delta) ?? 0) + 1)
    // Absteigend nach Größe, bei Gleichstand nach Abstand – dann von hinten, also die kleinsten zuerst
    const groups = [...byDelta].sort((a, b) => b[1] - a[1] || b[0] - a[0]).reverse()
    const total = groups.reduce((sum, [, n]) => sum + n, 0)
    let removedCount = 0
    for (const [delta, size] of groups) {
      if (removedCount + size >= Math.max(20, Math.floor(total / 20))) {
        if (size < 6 || delta > (rating === 4 ? 365 : 100)) removed.add(`${rating}:${delta}`)
      } else {
        removedCount += size
        removed.add(`${rating}:${delta}`)
      }
    }
  }
  return removed
}

export type TrainingData = {
  /** Anteil erinnerter Wiederholungen – vor dem Ausreißer-Filter */
  averageRecall: number
  pretrain: PretrainEntry[]
  /** Folgen nach dem Filter, mit Zeitgewichten – Ziele nur bis zur Länge MAX_SEQ_LEN */
  train: WeightedSequence[]
  /** Auswertbare Wiederholungen nach dem Filter (für die Schwellen „zu wenige Daten“) */
  reviews: number
  /** Jede Folge hat nur eine Langzeit-Wiederholung – dann gibt es nichts über die Anfangsstabilität hinaus zu lernen */
  onlyFirst: boolean
}

export function trainingData(sequences: FsrsSequence[]): TrainingData {
  const all = sequences.flatMap((seq) => evaluable(seq).map((i) => seq.ratings[i]))
  const averageRecall = all.length ? all.filter((r) => r > 1).length / all.length : 0
  const entry = (seq: FsrsSequence): PretrainEntry => {
    const f = evaluable(seq)[0]
    return { rating: seq.ratings[0], delta: seq.days[f], y: seq.ratings[f] > 1 ? 1 : 0 }
  }
  const removed = outliers(sequences.map(entry))
  // Folgen mit einem entfernten Paar fallen ganz heraus – aus Vortraining und Training
  const kept = sequences.filter((seq) => {
    const e = entry(seq)
    return !removed.has(`${e.rating}:${e.delta}`)
  })
  const reviews = kept.reduce((sum, seq) => sum + evaluable(seq).length, 0)
  return {
    averageRecall,
    pretrain: kept.map(entry),
    train: weighted(kept, MAX_SEQ_LEN),
    reviews,
    onlyFirst: kept.every((seq) => evaluable(seq).length === 1),
  }
}

/** Für die Bewertung von Gewichten: alle auswertbaren Wiederholungen – ohne Ausreißer-Filter und Längengrenze */
export function evaluationData(sequences: FsrsSequence[]): WeightedSequence[] {
  return weighted(sequences)
}
