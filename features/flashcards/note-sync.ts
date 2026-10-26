// Notiz und Karten abgleichen („Karteikarten aus Notiz“): Welche Karten aus der Notiz haben sich dort geändert, welche
// gibt es in der Notiz nicht mehr? Zugeordnet wird über den Inhalt – die Karte merkt sich nur ihre Notiz, nicht die
// Stelle darin.
import { clozeBlanks } from './cloze'
import type { Card, CardOption, CardType } from './types'

type Draft = { type: CardType; front: string; back: string; options: CardOption[] }

/** `exact`: gleiche Vorderseite (bei Lückentexten: gleicher Text um die Lücken) – sonst nur ähnlich („Frage geändert“) */
export type ChangedCard<C> = { candidate: number; card: C; exact: boolean }

export type SyncResult<C> = {
  unchanged: { candidate: number; card: C }[]
  changed: ChangedCard<C>[]
  /** Kandidaten ohne Karte (Indizes) */
  added: number[]
  /** Karten der Notiz ohne Gegenstück in der Notiz */
  orphaned: C[]
}

/** Ab diesem Anteil gemeinsamer Wörter gilt eine Vorderseite als umformuliert */
export const SIMILARITY = 0.6

const space = (s: string) => s.replace(/\s+/g, ' ').trim()
/** Vergleichsform der Vorderseite – wie „Schon vorhanden“ im Dialog */
export const normFront = (s: string) => space(s).toLowerCase()

// Lückentext: Was in den Lücken steht, ist die Antwort – zugeordnet wird über den Text drumherum
const matchKey = (d: Draft) => normFront(d.type === 'cloze' ? clozeBlanks(d.front) : d.front)

const optionsKey = (options: CardOption[]) => options.map((o) => `${o.correct ? '✓' : '·'}${space(o.text)}`).join('\n')

/** Gleicher Inhalt – Leerraum egal, Groß- und Kleinschreibung nicht. Bei Lückentexten zählt der Zusatz nicht. */
function sameContent(a: Draft, b: Draft): boolean {
  if (a.type !== b.type || space(a.front) !== space(b.front)) return false
  if (a.type === 'cloze') return true
  return space(a.back) === space(b.back) && optionsKey(a.options) === optionsKey(b.options)
}

const words = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])

/** Anteil gemeinsamer Wörter (Jaccard) zweier Vorderseiten, 0–1 */
export function similarity(a: string, b: string): number {
  const x = words(a)
  const y = words(b)
  if (x.size === 0 || y.size === 0) return 0
  let common = 0
  for (const w of x) if (y.has(w)) common++
  return common / (x.size + y.size - common)
}

/**
 * Kandidaten aus der Notiz (parseCardsFromNote) mit den Karten abgleichen, die aus ihr stammen. Zuerst gleicher Inhalt,
 * dann gleiche Vorderseite und gleicher Typ (geändert), zuletzt eine ähnliche Vorderseite (Vorschlag) – jeweils die
 * Karten in ihrer Reihenfolge, damit dieselbe Vorderseite zweimal nicht über Kreuz zugeordnet wird.
 */
export function syncCards<C extends Draft>(candidates: Draft[], cards: C[]): SyncResult<C> {
  const result: SyncResult<C> = { unchanged: [], changed: [], added: [], orphaned: [] }
  const free = new Set(cards.map((_, i) => i))
  const open = new Set(candidates.map((_, i) => i))
  const assign = (candidate: number, card: number) => {
    open.delete(candidate)
    free.delete(card)
  }

  for (const i of open) {
    const j = [...free].find((k) => sameContent(candidates[i], cards[k]))
    if (j === undefined) continue
    result.unchanged.push({ candidate: i, card: cards[j] })
    assign(i, j)
  }
  for (const i of open) {
    const key = matchKey(candidates[i])
    const j = [...free].find((k) => cards[k].type === candidates[i].type && matchKey(cards[k]) === key)
    if (j === undefined) continue
    result.changed.push({ candidate: i, card: cards[j], exact: true })
    assign(i, j)
  }
  // Ähnliche Vorderseiten: die ähnlichsten Paare zuerst
  const pairs: { i: number; j: number; score: number }[] = []
  for (const i of open) {
    for (const j of free) {
      const score = similarity(candidates[i].front, cards[j].front)
      if (score >= SIMILARITY) pairs.push({ i, j, score })
    }
  }
  pairs.sort((a, b) => b.score - a.score || a.i - b.i || a.j - b.j)
  for (const { i, j } of pairs) {
    if (!open.has(i) || !free.has(j)) continue
    result.changed.push({ candidate: i, card: cards[j], exact: false })
    assign(i, j)
  }

  result.changed.sort((a, b) => a.candidate - b.candidate)
  result.added = [...open].sort((a, b) => a - b)
  result.orphaned = [...free].sort((a, b) => a - b).map((j) => cards[j])
  return result
}

/** Karten, die aus dieser Notiz stammen und sich mit ihr abgleichen lassen – Bildverdeckungen entstehen nie aus Text */
export const noteCards = (cards: Card[], noteId: string) => cards.filter((c) => c.noteId === noteId && c.type !== 'occlusion')

/** Was sich an einer Karte ändert, für den Hinweis im Dialog */
export function changedParts(card: Draft, next: Draft): ('front' | 'back' | 'type')[] {
  const parts: ('front' | 'back' | 'type')[] = []
  if (space(card.front) !== space(next.front)) parts.push('front')
  if (card.type !== next.type) parts.push('type')
  if (next.type !== 'cloze' && (space(card.back) !== space(next.back) || optionsKey(card.options) !== optionsKey(next.options))) {
    parts.push('back')
  }
  return parts
}
