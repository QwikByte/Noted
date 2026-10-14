// Zusammenstellung der Lernsitzungen: welche Karten heute dran sind und in welcher Reihenfolge.
import { endOfDay, startOfDay } from './srs'
import type { Card, CardReview, Deck, SrsState } from './types'

export type Side = 0 | 1
export type ItemKind = 'new' | 'learning' | 'review'
export type StudyItem = { card: Card; side: Side; kind: ItemKind }
export type StateMap = Map<string, SrsState>

export const reviewKey = (cardId: string, side: Side) => `${cardId}:${side}`
export const itemKey = (item: { card: Card; side: Side }) => reviewKey(item.card.id, item.side)

/** Abgefragte Seiten einer Karte: beidseitige Karten werden in beide Richtungen gelernt. */
export function sidesOf(card: Pick<Card, 'type'>): Side[] {
  return card.type === 'reversed' ? [0, 1] : [0]
}

export function stateMap(reviews: CardReview[]): StateMap {
  const map: StateMap = new Map()
  for (const r of reviews) {
    const { cardId, side, ...state } = r
    map.set(reviewKey(cardId, side), state)
  }
  return map
}

export function byPosition(a: Card, b: Card) {
  return a.position - b.position || a.createdAt - b.createdAt
}

export type DeckCounts = {
  /** Abzufragende Seiten insgesamt */
  total: number
  /** Noch nie gelernt */
  newTotal: number
  /** Heute noch erlaubte neue Karten (Tageslimit) */
  newToday: number
  /** In der Lernphase und heute fällig */
  learning: number
  /** Gelernt und heute fällig */
  review: number
  /** Alles, was heute im Lernmodus drankommt */
  due: number
  /** Heute schon abgefragt */
  reviewedToday: number
  /** Morgen fällig (ohne neue Karten) */
  dueTomorrow: number
}

type Plan = { fresh: StudyItem[]; learning: StudyItem[]; review: StudyItem[]; counts: DeckCounts }

/** Ermittelt für einen Stapel, was heute zu lernen ist. */
function planDeck(deck: Pick<Deck, 'newPerDay'>, cards: Card[], states: StateMap, now: number): Plan {
  const today = startOfDay(now)
  const eod = endOfDay(now)
  const eot = eod + 86_400_000
  const fresh: StudyItem[] = []
  const learning: StudyItem[] = []
  const review: StudyItem[] = []
  let total = 0
  let newTotal = 0
  let introducedToday = 0
  let reviewedToday = 0
  let dueTomorrow = 0
  const candidates: StudyItem[] = []

  for (const card of [...cards].sort(byPosition)) {
    for (const side of sidesOf(card)) {
      total++
      const state = states.get(reviewKey(card.id, side))
      if (!state) {
        newTotal++
        // Rückseite einer beidseitigen Karte erst, wenn die Vorderseite nicht mehr ganz neu ist
        if (side === 1) {
          const front = states.get(reviewKey(card.id, 0))
          if (!front || front.introducedAt >= today) continue
        }
        candidates.push({ card, side, kind: 'new' })
        continue
      }
      if (state.introducedAt >= today) introducedToday++
      if (state.reviewedAt >= today) reviewedToday++
      if (state.due <= eod) {
        if (state.phase === 'review') review.push({ card, side, kind: 'review' })
        else learning.push({ card, side, kind: 'learning' })
      } else if (state.due <= eot) dueTomorrow++
    }
  }
  const newToday = Math.max(0, Math.min(candidates.length, deck.newPerDay - introducedToday))
  fresh.push(...candidates.slice(0, newToday))
  const due = (item: StudyItem) => states.get(itemKey(item))?.due ?? 0
  review.sort((a, b) => due(a) - due(b))
  learning.sort((a, b) => due(a) - due(b))
  return {
    fresh,
    learning,
    review,
    counts: {
      total,
      newTotal,
      newToday,
      learning: learning.length,
      review: review.length,
      due: newToday + learning.length + review.length,
      reviewedToday,
      dueTomorrow,
    },
  }
}

export function deckCounts(deck: Pick<Deck, 'newPerDay'>, cards: Card[], states: StateMap, now: number): DeckCounts {
  return planDeck(deck, cards, states, now).counts
}

/** Neue Karten gleichmäßig zwischen die Wiederholungen verteilen. */
function interleave(review: StudyItem[], fresh: StudyItem[]): StudyItem[] {
  if (fresh.length === 0) return review
  if (review.length === 0) return fresh
  const out: StudyItem[] = []
  const every = review.length / (fresh.length + 1)
  let f = 0
  review.forEach((item, i) => {
    out.push(item)
    while (f < fresh.length && (i + 1) >= every * (f + 1)) out.push(fresh[f++])
  })
  while (f < fresh.length) out.push(fresh[f++])
  return out
}

/**
 * Lernsitzung im Lernmodus: fällige Wiederholungen und neue Karten (Tageslimit je Stapel).
 * Karten in der Lernphase kommen wieder, sobald ihr Lernschritt abgelaufen ist – sind sonst keine Karten
 * mehr übrig, auch etwas früher.
 */
export class LearnSession {
  private main: StudyItem[]
  private learning: { item: StudyItem; due: number }[]

  constructor(decks: Pick<Deck, 'id' | 'newPerDay'>[], cards: Card[], states: StateMap, now: number) {
    const byDeck = new Map<string, Card[]>()
    for (const c of cards) {
      const list = byDeck.get(c.deckId)
      if (list) list.push(c)
      else byDeck.set(c.deckId, [c])
    }
    const review: StudyItem[] = []
    const fresh: StudyItem[] = []
    const learning: { item: StudyItem; due: number }[] = []
    for (const deck of decks) {
      const plan = planDeck(deck, byDeck.get(deck.id) ?? [], states, now)
      review.push(...plan.review)
      fresh.push(...plan.fresh)
      for (const item of plan.learning) learning.push({ item, due: states.get(itemKey(item))?.due ?? now })
    }
    const due = (item: StudyItem) => states.get(itemKey(item))?.due ?? 0
    review.sort((a, b) => due(a) - due(b))
    this.main = interleave(review, fresh)
    this.learning = learning.sort((a, b) => a.due - b.due)
  }

  next(now: number): StudyItem | null {
    if (this.learning.length > 0 && this.learning[0].due <= now) return this.learning.shift()!.item
    if (this.main.length > 0) return this.main.shift()!
    if (this.learning.length > 0) return this.learning.shift()!.item
    return null
  }

  /** Nach der Bewertung: Karten, die heute noch einmal drankommen, wieder einreihen. */
  answered(item: StudyItem, state: SrsState, now: number) {
    if (state.phase === 'review' || state.due > endOfDay(now)) return
    const entry = { item: { ...item, kind: 'learning' as const }, due: state.due }
    const idx = this.learning.findIndex((l) => l.due > state.due)
    if (idx < 0) this.learning.push(entry)
    else this.learning.splice(idx, 0, entry)
  }

  /** Verbleibende Karten nach Art (ohne die aktuell angezeigte) */
  remaining(): Record<ItemKind, number> {
    const counts = { new: 0, learning: this.learning.length, review: 0 }
    for (const item of this.main) counts[item.kind === 'new' ? 'new' : 'review']++
    return counts
  }

  get size() {
    return this.main.length + this.learning.length
  }
}

export function shuffle<T>(list: T[], random: () => number = Math.random): T[] {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Übungsmodus (z. B. vor der Klausur): alle Karten in zufälliger Reihenfolge, ohne den Wiederholungsplan
 * zu verändern. Falsch beantwortete Karten kommen nach ein paar anderen erneut, bis alles einmal gewusst wurde.
 */
export class PracticeSession {
  private queue: StudyItem[]
  /** Ergebnis beim ersten Versuch */
  readonly firstTry = new Map<string, boolean>()
  /** Schon gewusste Karten (fertig für diese Übung) */
  readonly done = new Set<string>()
  readonly total: number

  constructor(items: StudyItem[], random: () => number = Math.random) {
    this.queue = shuffle(items, random)
    this.total = items.length
  }

  next(): StudyItem | null {
    return this.queue.shift() ?? null
  }

  answered(item: StudyItem, correct: boolean) {
    const key = itemKey(item)
    if (!this.firstTry.has(key)) this.firstTry.set(key, correct)
    if (correct) this.done.add(key)
    else this.queue.splice(Math.min(this.queue.length, 4), 0, item)
  }

  get remaining() {
    return this.queue.length
  }

  get correctFirstTry() {
    let n = 0
    for (const ok of this.firstTry.values()) if (ok) n++
    return n
  }

  /** Beim ersten Versuch falsch beantwortete Karten (für „Fehler wiederholen“) */
  missed(items: StudyItem[]): StudyItem[] {
    return items.filter((i) => this.firstTry.get(itemKey(i)) === false)
  }
}

/** Alle abzufragenden Seiten der Karten (für den Übungsmodus). */
export function allItems(cards: Card[]): StudyItem[] {
  return [...cards].sort(byPosition).flatMap((card) => sidesOf(card).map((side) => ({ card, side, kind: 'review' as const })))
}

/** Multiple Choice: Ist die Auswahl genau die Menge der richtigen Antworten? */
export function isCorrectSelection(options: { correct: boolean }[], selected: Set<number>): boolean {
  return options.every((o, i) => o.correct === selected.has(i))
}
