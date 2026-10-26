// Zusammenstellung der Lernsitzungen: welche Karten heute dran sind und in welcher Reihenfolge.
import { LEECH_LAPSES, endOfDay, startOfDay } from './srs'
import { clozeCount, clozeTexts } from './cloze'
import { daysUntil, examDue, nextExam } from './exam'
import type { Card, CardReview, Deck, SrsState } from './types'

/** Abgefragte Seite: 0 = Vorderseite, 1 = Rückseite (beidseitig), bei Lückentexten die Nummer der Lücke */
export type Side = number
export type ItemKind = 'new' | 'learning' | 'review'
export type StudyItem = { card: Card; side: Side; kind: ItemKind }
export type StateMap = Map<string, SrsState>

export const reviewKey = (cardId: string, side: Side) => `${cardId}:${side}`
export const itemKey = (item: { card: Card; side: Side }) => reviewKey(item.card.id, item.side)

/** Was es braucht, um die abgefragten Seiten einer Karte zu bestimmen */
type Sided = Pick<Card, 'type' | 'front'> & { occlusion?: Card['occlusion'] }

/**
 * Abgefragte Seiten einer Karte: beidseitige Karten in beide Richtungen, Lückentexte jede Lücke und
 * Bildverdeckungen jede Fläche für sich.
 */
export function sidesOf(card: Sided): Side[] {
  if (card.type === 'cloze') return Array.from({ length: clozeCount(card.front) }, (_, i) => i)
  if (card.type === 'occlusion') return Array.from({ length: card.occlusion?.masks.length ?? 0 }, (_, i) => i)
  return card.type === 'reversed' ? [0, 1] : [0]
}

/**
 * Lücken über ihren Text zuordnen: gleiche in derselben Reihenfolge (längste gemeinsame Teilfolge), dann umgestellte
 * mit gleichem Text. Liegen zwischen zwei in Reihenfolge gefundenen gleich viele übrige, sind sie umformuliert und
 * werden paarweise zugeordnet; sonst gelten sie als neu.
 */
function matchInOrder(before: string[], after: string[]): (Side | null)[] {
  const n = before.length
  const m = after.length
  // common[i][j]: Länge der längsten gemeinsamen Teilfolge von before[i…] und after[j…]
  const common = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      common[i][j] = before[i] === after[j] ? common[i + 1][j + 1] + 1 : Math.max(common[i + 1][j], common[i][j + 1])
    }
  }
  const map = new Array<Side | null>(m).fill(null)
  const anchors: [number, number][] = []
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (before[i] === after[j]) {
      anchors.push([i, j])
      map[j++] = i++
    } else if (common[i + 1][j] >= common[i][j + 1]) i++
    else j++
  }
  const taken = new Set(map)
  for (let j = 0; j < m; j++) {
    if (map[j] !== null) continue
    const i = before.findIndex((text, k) => text === after[j] && !taken.has(k))
    if (i >= 0) {
      map[j] = i
      taken.add(i)
    }
  }
  let pi = -1
  let pj = -1
  for (const [i, j] of [...anchors, [n, m]]) {
    const olds = Array.from({ length: i - pi - 1 }, (_, k) => pi + 1 + k).filter((k) => !taken.has(k))
    const news = Array.from({ length: j - pj - 1 }, (_, k) => pj + 1 + k).filter((k) => map[k] === null)
    if (olds.length === news.length) news.forEach((k, x) => (map[k] = olds[x]))
    pi = i
    pj = j
  }
  return map
}

/**
 * Für jede Seite der bearbeiteten Karte die bisherige Seite (null = neu), damit der Lernstand bei seiner Lücke bzw.
 * Fläche bleibt: Lücken werden über ihren Text zugeordnet, Flächen über ihre Kennung. Ändert sich die Kartenart oder
 * ist es eine andere, bleibt es bei der Position.
 */
export function remapSides(before: Sided, after: Sided): (Side | null)[] {
  if (before.type === 'cloze' && after.type === 'cloze') {
    const text = (front: string) => clozeTexts(front).map((t) => t.trim())
    return matchInOrder(text(before.front), text(after.front))
  }
  if (before.type === 'occlusion' && after.type === 'occlusion') {
    const old = new Map(before.occlusion?.masks.map((m, i) => [m.id, i]))
    return (after.occlusion?.masks ?? []).map((m) => (m.id === undefined ? null : (old.get(m.id) ?? null)))
  }
  const count = sidesOf(before).length
  return sidesOf(after).map((side) => (side < count ? side : null))
}

/** Neue Nummer jeder bisherigen Seite zu `remapSides` – weggefallene Seiten fehlen */
export const movedSides = (sideMap: (Side | null)[]) =>
  new Map(sideMap.flatMap((old, side) => (old === null ? [] : [[old, side] as const])))

export function stateMap(reviews: CardReview[]): StateMap {
  const map: StateMap = new Map()
  for (const r of reviews) {
    const { cardId, side, ...state } = r
    map.set(reviewKey(cardId, side), state)
  }
  return map
}

/** Karten je Stapel, in der Reihenfolge von `cards` */
export function cardsByDeck(cards: Card[]): Map<string, Card[]> {
  const byDeck = new Map<string, Card[]>()
  for (const c of cards) {
    const list = byDeck.get(c.deckId)
    if (list) list.push(c)
    else byDeck.set(c.deckId, [c])
  }
  return byDeck
}

export function byPosition(a: Card, b: Card) {
  return a.position - b.position || a.createdAt - b.createdAt
}

/** Wie oft die Karte vergessen wurde – bei beidseitigen Karten und Lückentexten die schwächste Seite */
export function cardLapses(card: Sided & Pick<Card, 'id'>, states: StateMap): number {
  return Math.max(0, ...sidesOf(card).map((side) => states.get(reviewKey(card.id, side))?.lapses ?? 0))
}

export const isProblemCard = (card: Sided & Pick<Card, 'id'>, states: StateMap) =>
  cardLapses(card, states) >= LEECH_LAPSES

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
  /** Heute zum ersten Mal gelernt (zählt für das Tageslimit) */
  introducedToday: number
  /** Morgen fällig (ohne neue Karten) */
  dueTomorrow: number
}

type Plan = { fresh: StudyItem[]; learning: StudyItem[]; review: StudyItem[]; counts: DeckCounts }

type PlannedDeck = Pick<Deck, 'newPerDay' | 'exams'>

/**
 * Ermittelt für einen Stapel, was heute zu lernen ist. `inScope` grenzt die Karten ein (z. B. nur die einer Notiz) –
 * das Tageslimit für neue Karten zählt trotzdem über den ganzen Stapel. Ausgesetzte Karten kommen nicht dran.
 * Steht eine Klausur an, rücken Wiederholungen davor (siehe exam.ts).
 */
function planDeck(deck: PlannedDeck, cards: Card[], states: StateMap, now: number, inScope?: (card: Card) => boolean): Plan {
  const today = startOfDay(now)
  const exam = nextExam(deck.exams, now)
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

  // Geschwister zurückstellen (wie „bury siblings“ bei Anki): Seiten derselben Karte verraten sich sonst gegenseitig –
  // bei Lücke 2 steht Lücke 1 schon ausgefüllt im Satz. Nicht am Tag vor der Klausur, da muss alles drankommen.
  const bury = !exam || daysUntil(exam, now) > 1

  for (const card of [...cards].sort(byPosition)) {
    const counted = !card.suspended && (!inScope || inScope(card))
    const sides = sidesOf(card).map((side) => ({ side, state: states.get(reviewKey(card.id, side)) }))
    for (const { state } of sides) if (state && state.introducedAt >= today) introducedToday++
    if (!counted) continue
    // Heute schon eine Seite gelernt: keine weitere Wiederholung und keine neue Seite dieser Karte mehr
    const studiedToday = bury && sides.some(({ state }) => state && state.reviewedAt >= today)
    const dueReviews: { item: StudyItem; due: number }[] = []
    const newSides: StudyItem[] = []
    let planned = false
    for (const { side, state } of sides) {
      total++
      if (!state) {
        newTotal++
        // Rückseite einer beidseitigen Karte bzw. nächste Lücke erst, wenn die vorige nicht mehr ganz neu ist –
        // so kommt je Karte höchstens eine neue Seite pro Tag dazu
        if (side > 0) {
          const previous = states.get(reviewKey(card.id, side - 1))
          if (!previous || previous.introducedAt >= today) continue
        }
        newSides.push({ card, side, kind: 'new' })
        continue
      }
      if (state.reviewedAt >= today) reviewedToday++
      const due = exam ? examDue(state, reviewKey(card.id, side), exam, now) : state.due
      if (due <= eod) {
        if (state.phase === 'review') dueReviews.push({ item: { card, side, kind: 'review' }, due })
        else {
          // Lernschritte laufen heute weiter, auch bei Geschwistern
          learning.push({ card, side, kind: 'learning' })
          planned = true
        }
      } else if (due <= eot) dueTomorrow++
    }
    // Je Karte höchstens eine Wiederholung pro Tag – die am längsten überfällige; die übrigen kommen morgen
    const kept = !bury ? dueReviews : studiedToday ? [] : [...dueReviews].sort((a, b) => a.due - b.due).slice(0, 1)
    review.push(...kept.map((r) => r.item))
    dueTomorrow += dueReviews.length - kept.length
    if (!bury || !(studiedToday || planned || kept.length > 0)) candidates.push(...newSides)
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
      introducedToday,
      dueTomorrow,
    },
  }
}

export function deckCounts(deck: PlannedDeck, cards: Card[], states: StateMap, now: number): DeckCounts {
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
  /** Nach „Rückgängig“ zurückgelegte Karten – kommen vor allen anderen dran, die zuletzt zurückgelegte zuerst */
  private front: StudyItem[] = []

  /** `cards`: alle Karten der Stapel (für das Tageslimit), `inScope`: welche davon gelernt werden */
  constructor(
    decks: (PlannedDeck & Pick<Deck, 'id'>)[],
    cards: Card[],
    states: StateMap,
    now: number,
    inScope?: (card: Card) => boolean,
  ) {
    const byDeck = cardsByDeck(cards)
    const review: StudyItem[] = []
    const fresh: StudyItem[] = []
    const learning: { item: StudyItem; due: number }[] = []
    for (const deck of decks) {
      const plan = planDeck(deck, byDeck.get(deck.id) ?? [], states, now, inScope)
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
    if (this.front.length > 0) return this.front.pop()!
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

  /**
   * Bewertung von `item` zurückgenommen: Was `answered` wieder eingereiht hat, fällt weg, `item` kommt sofort wieder
   * dran und die gerade angezeigte Karte `current` direkt danach.
   */
  undo(item: StudyItem, current: StudyItem | null) {
    const key = itemKey(item)
    // Jede Kartenseite steht höchstens einmal in der Sitzung – ist `current` die wieder eingereihte, wird sie verworfen
    this.learning = this.learning.filter((l) => itemKey(l.item) !== key)
    if (current && itemKey(current) !== key) this.front.push(current)
    this.front.push(item)
  }

  /** Karte ausgesetzt: alle ihre Seiten aus der Sitzung nehmen, auch die wieder eingereihten in der Lernphase */
  skipCard(cardId: string) {
    this.front = this.front.filter((i) => i.card.id !== cardId)
    this.main = this.main.filter((i) => i.card.id !== cardId)
    this.learning = this.learning.filter((l) => l.item.card.id !== cardId)
  }

  /** Verbleibende Karten nach Art (ohne die aktuell angezeigte) */
  remaining(): Record<ItemKind, number> {
    const counts = { new: 0, learning: this.learning.length, review: 0 }
    for (const item of this.front) counts[item.kind]++
    for (const item of this.main) counts[item.kind === 'new' ? 'new' : 'review']++
    return counts
  }

  get size() {
    return this.front.length + this.main.length + this.learning.length
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
  private readonly items: StudyItem[]
  /** In dieser Übung ausgesetzte Karten */
  private readonly skipped = new Set<string>()
  /** Ergebnis beim ersten Versuch */
  readonly firstTry = new Map<string, boolean>()
  /** Schon gewusste Karten (fertig für diese Übung) */
  readonly done = new Set<string>()

  constructor(items: StudyItem[], random: () => number = Math.random) {
    this.items = items
    this.queue = shuffle(items, random)
  }

  /** Abgefragte Seiten insgesamt – von ausgesetzten Karten nur die schon gewussten */
  get total() {
    return this.items.filter((i) => !this.skipped.has(i.card.id) || this.done.has(itemKey(i))).length
  }

  /** Karte ausgesetzt: ihre übrigen Seiten kommen in dieser Übung nicht mehr dran */
  skipCard(cardId: string) {
    this.skipped.add(cardId)
    this.queue = this.queue.filter((i) => i.card.id !== cardId)
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
    return items.filter((i) => !this.skipped.has(i.card.id) && this.firstTry.get(itemKey(i)) === false)
  }
}

/** Alle abzufragenden Seiten der Karten ohne die ausgesetzten (für den Übungsmodus). */
export function allItems(cards: Card[]): StudyItem[] {
  return cards
    .filter((card) => !card.suspended)
    .sort(byPosition)
    .flatMap((card) => sidesOf(card).map((side) => ({ card, side, kind: 'review' as const })))
}

/** Eigene Übungen: Problemkarten, die schwersten Karten oder heute mit „Nochmal“ bewertete */
export type StudyFilter = 'problem' | 'hardest' | 'again-today'

export const STUDY_FILTERS: readonly StudyFilter[] = ['again-today', 'problem', 'hardest']

/** So viele Seiten umfasst „Schwerste“ */
export const HARDEST_COUNT = 50

/**
 * Wie schwer eine gelernte Seite ist, von 0 bis 1: mit FSRS aus der Schwierigkeit (1–10), sonst aus der Leichtigkeit
 * von SM-2 (2,5 beim Start, 1,3 als Minimum) – so lassen sich Stapel mit beiden Plänen gemeinsam sortieren
 */
export function hardness(state: SrsState): number {
  if (state.difficulty != null) return (state.difficulty - 1) / 9
  return Math.min(1, Math.max(0, (2.5 - state.ease) / (2.5 - 1.3)))
}

/**
 * Seiten für eine eigene Übung – ohne ausgesetzte Karten. `again`: Kartenseiten (reviewKey), die heute mit „Nochmal“
 * bewertet wurden.
 */
export function filterItems(
  filter: StudyFilter,
  cards: Card[],
  states: StateMap,
  opts: { again?: ReadonlySet<string>; limit?: number } = {},
): StudyItem[] {
  const items = allItems(cards)
  if (filter === 'problem') return items.filter((i) => isProblemCard(i.card, states))
  if (filter === 'again-today') return items.filter((i) => opts.again?.has(itemKey(i)))
  // Schwerste: nur schon gelernte Seiten, bei Gleichstand die öfter vergessenen
  return items
    .map((item) => ({ item, state: states.get(itemKey(item)) }))
    .filter((x): x is { item: StudyItem; state: SrsState } => !!x.state)
    .sort((a, b) => hardness(b.state) - hardness(a.state) || b.state.lapses - a.state.lapses)
    .slice(0, opts.limit ?? HARDEST_COUNT)
    .map((x) => x.item)
}

/** Multiple Choice: Ist die Auswahl genau die Menge der richtigen Antworten? */
export function isCorrectSelection(options: { correct: boolean }[], selected: Set<number>): boolean {
  return options.every((o, i) => o.correct === selected.has(i))
}
