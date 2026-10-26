// Kartenbrowser: Karten aller Stapel durchsuchen, filtern und sortieren – reine Logik ohne Browser. Die Suche gilt
// auch in der Liste eines Stapels.
import { cardStatus, endOfDay, type CardStatus } from './srs'
import { byPosition, cardLapses, hardness, isProblemCard, reviewKey, sidesOf, type StateMap } from './study'
import type { Card, CardType, Deck } from './types'

export type BrowseFilter = {
  query: string
  /** null: alle Stapel */
  deckId: string | null
  type: CardType | null
  /** Eine Seite der Karte hat diesen Stand */
  status: CardStatus | null
  /** Heute (bis Tagesende) fällig – ausgesetzte nicht */
  due: boolean
  problem: boolean
  suspended: boolean
  /** Aus einer Notiz entstanden */
  fromNote: boolean
}

export const NO_FILTER: BrowseFilter = {
  query: '',
  deckId: null,
  type: null,
  status: null,
  due: false,
  problem: false,
  suspended: false,
  fromNote: false,
}

/** position: Stapel (nach Name), darin die Reihenfolge des Stapels · created: neueste zuerst · due: früheste zuerst, neue
 *  Karten zuletzt · lapses: am öftesten vergessen zuerst · difficulty: schwerste zuerst (FSRS bzw. SM-2) */
export type BrowseSort = 'position' | 'created' | 'due' | 'lapses' | 'difficulty'

export const BROWSE_SORTS: { value: BrowseSort; label: string }[] = [
  { value: 'position', label: 'Stapel und Reihenfolge' },
  { value: 'created', label: 'Zuletzt angelegt' },
  { value: 'due', label: 'Fälligkeit' },
  { value: 'lapses', label: 'Am öftesten vergessen' },
  { value: 'difficulty', label: 'Schwierigkeit' },
]

/** Sucht in Vorderseite, Rückseite, Antworten und Beschriftungen der Flächen (ohne Groß- und Kleinschreibung) */
export function cardMatches(card: Card, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const texts = [card.front, card.back, ...card.options.map((o) => o.text), ...(card.occlusion?.masks.map((m) => m.label) ?? [])]
  return texts.some((t) => t.toLowerCase().includes(q))
}

const statesOf = (card: Card, states: StateMap) => sidesOf(card).map((side) => states.get(reviewKey(card.id, side)) ?? null)

/** Früheste Fälligkeit einer Seite – Infinity, solange eine Seite neu ist (zählt beim Sortieren als neu) */
function earliestDue(card: Card, states: StateMap): number {
  let due = Infinity
  for (const s of statesOf(card, states)) {
    if (!s) return Infinity
    due = Math.min(due, s.due)
  }
  return due
}

const cardHardness = (card: Card, states: StateMap) =>
  Math.max(-1, ...statesOf(card, states).map((s) => (s ? hardness(s) : -1)))

/** Karten, die zu allen gewählten Filtern passen, in der gewählten Reihenfolge */
export function browseCards(
  cards: Card[],
  decks: Deck[],
  states: StateMap,
  filter: BrowseFilter,
  sort: BrowseSort,
  now: number,
): Card[] {
  const eod = endOfDay(now)
  const matching = cards.filter((card) => {
    if (filter.deckId && card.deckId !== filter.deckId) return false
    if (filter.type && card.type !== filter.type) return false
    if (filter.suspended && !card.suspended) return false
    if (filter.fromNote && !card.noteId) return false
    if (filter.problem && !isProblemCard(card, states)) return false
    if (filter.status && !statesOf(card, states).some((s) => cardStatus(s) === filter.status)) return false
    if (filter.due && (card.suspended || !statesOf(card, states).some((s) => s && s.due <= eod))) return false
    return cardMatches(card, filter.query)
  })
  const deckOrder = new Map(
    [...decks].sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' })).map((d, i) => [d.id, i]),
  )
  const compare: Record<BrowseSort, (a: Card, b: Card) => number> = {
    position: (a, b) => (deckOrder.get(a.deckId) ?? 0) - (deckOrder.get(b.deckId) ?? 0) || byPosition(a, b),
    created: (a, b) => b.createdAt - a.createdAt,
    due: (a, b) => {
      const x = earliestDue(a, states)
      const y = earliestDue(b, states)
      return x === y ? byPosition(a, b) : x === Infinity ? 1 : y === Infinity ? -1 : x - y
    },
    lapses: (a, b) => cardLapses(b, states) - cardLapses(a, states) || byPosition(a, b),
    difficulty: (a, b) => cardHardness(b, states) - cardHardness(a, states) || byPosition(a, b),
  }
  return matching.sort(compare[sort])
}
