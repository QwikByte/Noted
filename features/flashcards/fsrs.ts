// Wiederholungsplan mit FSRS (Free Spaced Repetition Scheduler, Version 5) – wählbar je Stapel statt SM-2.
// FSRS schätzt für jede Kartenseite die Stabilität S (Tage, bis die Erinnerung auf 90 % gefallen ist) und die
// Schwierigkeit D (1–10) und legt den nächsten Termin so, dass die gewünschte Behaltensrate erreicht wird.
// Formeln und Standardparameter: https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm
// Die Lernschritte für neue und vergessene Karten bleiben wie bei SM-2 (siehe srs.ts). Die Gewichte w lassen sich auf
// den eigenen Lernverlauf optimieren (fsrs-optimizer.ts) – ohne gelten die Standardwerte.

/** Standardparameter von FSRS-5 (ohne Optimierung auf den eigenen Lernverlauf) */
export const DEFAULT_WEIGHTS: readonly number[] = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605,
  2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
]

/** Erlaubter Bereich je Gewicht beim Optimieren (wie fsrs-rs v2.0.4, parameter_clipper.rs) */
export const WEIGHT_CLAMPS: readonly (readonly [number, number])[] = [
  [0.01, 100],
  [0.01, 100],
  [0.01, 100],
  [0.01, 100],
  [1, 10],
  [0.001, 4],
  [0.001, 4],
  [0.001, 0.75],
  [0, 4.5],
  [0, 0.8],
  [0.001, 3.5],
  [0.001, 5],
  [0.001, 0.25],
  [0.001, 0.9],
  [0, 4],
  [0, 1],
  [1, 6],
  [0, 2],
  [0, 2],
]

/** Gewichte in ihren erlaubten Bereich holen */
export function clipWeights(w: readonly number[]): number[] {
  return w.map((v, i) => Math.min(WEIGHT_CLAMPS[i][1], Math.max(WEIGHT_CLAMPS[i][0], v)))
}

const DECAY = -0.5
/** So gewählt, dass die Erinnerung nach S Tagen genau 90 % beträgt */
const FACTOR = 19 / 81

export type Memory = { stability: number; difficulty: number }

const clampDifficulty = (d: number) => Math.min(10, Math.max(1, d))
const clampStability = (s: number) => Math.min(36_500, Math.max(0.01, s))

/** Wahrscheinlichkeit, sich nach `days` Tagen noch zu erinnern */
export const retrievability = (days: number, stability: number) => (1 + (FACTOR * Math.max(0, days)) / stability) ** DECAY

/** Abstand in Tagen, nach dem die Erinnerung auf die gewünschte Behaltensrate gefallen ist */
export const fsrsInterval = (stability: number, retention: number) => (stability / FACTOR) * (retention ** (1 / DECAY) - 1)

const initialDifficulty = (rating: number, w: readonly number[]) => clampDifficulty(w[4] - Math.exp(w[5] * (rating - 1)) + 1)

/** Erste Bewertung einer neuen Kartenseite */
export function initialMemory(rating: number, w: readonly number[] = DEFAULT_WEIGHTS): Memory {
  return { stability: w[rating - 1], difficulty: initialDifficulty(rating, w) }
}

function nextDifficulty(d: number, rating: number, w: readonly number[]): number {
  const delta = -w[6] * (rating - 3)
  // Gedämpft (je schwerer, desto weniger steigt sie) und mit leichtem Zug zurück zum Ausgangswert
  const damped = d + (delta * (10 - d)) / 9
  return clampDifficulty(w[7] * initialDifficulty(4, w) + (1 - w[7]) * damped)
}

/**
 * Neue Stabilität und Schwierigkeit nach einer Bewertung. `elapsedDays` seit der letzten Bewertung – unter einem Tag
 * (Lernschritte, mehrfach am selben Tag) gilt die Kurzzeitformel von FSRS-5.
 */
export function nextMemory(
  memory: Memory,
  rating: number,
  elapsedDays: number,
  w: readonly number[] = DEFAULT_WEIGHTS,
): Memory {
  const { stability: s, difficulty: d } = memory
  const difficulty = nextDifficulty(d, rating, w)
  if (elapsedDays < 1) return { stability: clampStability(s * Math.exp(w[17] * (rating - 3 + w[18]))), difficulty }
  const r = retrievability(elapsedDays, s)
  if (rating === 1) {
    // Nach dem Vergessen nie stabiler als vorher
    const forgot = w[11] * d ** -w[12] * ((s + 1) ** w[13] - 1) * Math.exp(w[14] * (1 - r))
    return { stability: clampStability(Math.min(s, forgot)), difficulty }
  }
  const hard = rating === 2 ? w[15] : 1
  const easy = rating === 4 ? w[16] : 1
  const growth = Math.exp(w[8]) * (11 - d) * s ** -w[9] * (Math.exp(w[10] * (1 - r)) - 1) * hard * easy
  return { stability: clampStability(s * (1 + growth)), difficulty }
}

/**
 * Schätzung für Kartenseiten, die bisher mit SM-2 geplant wurden: Der SM-2-Abstand gilt als Stabilität (beide zielen
 * auf rund 90 % Behaltensrate), die Leichtigkeit wird auf die Schwierigkeit abgebildet (2,5 → 4, 1,3 → 10).
 */
export function memoryFromSm2(interval: number, ease: number, w: readonly number[] = DEFAULT_WEIGHTS): Memory {
  return {
    stability: clampStability(interval > 0 ? interval : w[2]),
    difficulty: clampDifficulty(10 - (ease - 1.3) * 5),
  }
}
