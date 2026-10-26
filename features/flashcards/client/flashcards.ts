'use client'
// Karteikarten im Browser: Daten laden, Änderungen an den Server schicken und Bewertungen aus Lernsitzungen
// lokal sammeln. Bewertungen funktionieren auch offline – sie liegen bis zum Senden im localStorage, zusammen mit
// ihrem Eintrag fürs Bewertungsprotokoll (Statistik) und zurückgenommenen Bewertungen. Klausuren aus dem Kalender
// werden an ihre Stapel gehängt.

import { useMemo, useSyncExternalStore } from 'react'
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/shared/client/api'
import { useNow } from '@/shared/client/now'
import { deviceTimeZone, useEvents } from '@/features/calendar/client/calendar'
import { examsByDeck } from '../exam'
import { startOfDay } from '../srs'
import { movedSides, reviewKey, sidesOf, stateMap, type Side, type StateMap } from '../study'
import type {
  AnkiImportResult,
  Card,
  CardOption,
  CardReview,
  CardType,
  CardBatchAction,
  CardBatchResult,
  CardUpdateResult,
  Deck,
  DeckImportResult,
  FlashcardData,
  FsrsOptimizeResult,
  Occlusion,
  ReviewLogEntry,
  ReviewUndo,
} from '../types'

export const flashcardsKey = ['flashcards'] as const

const FLUSH_DELAY = 1500
const RETRY_INTERVAL = 30_000
/** Höchstens so viele Bewertungen pro Anfrage – mehr in mehreren (der Server nimmt bis zu 5000) */
const REVIEW_BATCH = 1000
/** Höchstens so viele Protokolleinträge pro Anfrage bzw. im Speicher (älteste fallen zuerst weg) */
const LOG_BATCH = 5000
const MAX_LOG = 20_000

type Stored = { pending: CardReview[]; acked: CardReview[]; log: ReviewLogEntry[]; undo: ReviewUndo[]; undone: ReviewUndo[] }

/** Eine bestimmte Bewertung einer Kartenseite (Protokolleintrag, Rücknahme) */
const ratingKey = (e: Pick<ReviewLogEntry, 'cardId' | 'side' | 'reviewedAt'>) => `${e.cardId}:${e.side}:${e.reviewedAt}`

/** Jüngere Bewertung einer Kartenseite übernehmen */
function upsert(map: Map<string, CardReview>, r: CardReview): boolean {
  const key = reviewKey(r.cardId, r.side)
  const cur = map.get(key)
  if (cur && cur.reviewedAt >= r.reviewedAt) return false
  map.set(key, r)
  return true
}

/**
 * Warteschlange für Bewertungen:
 *  - pending: noch nicht gesendet
 *  - acked:   gesendet, aber evtl. noch nicht in den Daten, die der Service Worker für offline zwischengespeichert
 *             hat – bleiben deshalb als Überlagerung, bis eine Antwort vom Server sie enthält
 *  - log:     noch nicht gesendete Einträge fürs Bewertungsprotokoll – anders als `pending` jede einzelne Bewertung,
 *             nicht nur die letzte je Kartenseite
 *  - undo:    zurückgenommene Bewertungen („Rückgängig“ beim Lernen), noch nicht gesendet
 *  - undone:  gesendete Rücknahmen – bleiben wie `acked` als Überlagerung, bis eine Antwort vom Server sie enthält
 * Mehrere Tabs teilen sich den Speicher und führen ihren Stand zusammen. Doppelt gesendete Protokolleinträge und
 * Rücknahmen verwirft der Server.
 */
export class ReviewQueue {
  private storageKey = ''
  private pending = new Map<string, CardReview>()
  private acked = new Map<string, CardReview>()
  private log = new Map<string, ReviewLogEntry>()
  private undoing = new Map<string, ReviewUndo>()
  private undone = new Map<string, ReviewUndo>()
  /** Zurückgenommene Bewertungen – weder als Lernstand noch im Protokoll aus dem Speicher eines Tabs zurückholen */
  private revoked = new Set<string>()
  /** Erledigte Rücknahmen (der Server kennt sie) – nicht aus dem Speicher eines anderen Tabs zurückholen */
  private settledUndo = new Set<string>()
  /** In dieser Sitzung gesendete Protokolleinträge – nicht aus dem Speicher eines anderen Tabs zurückholen */
  private sentLog = new Set<string>()
  /** In dieser Sitzung verworfene Karten (gelöscht, Lernstand zurückgesetzt) – nicht aus anderen Tabs zurückholen */
  private dropped = new Set<string>()
  /** Erledigte Einträge je Kartenseite (bis zu diesem Zeitpunkt) – nicht aus dem Speicher zurückholen */
  private forgotten = new Map<string, number>()
  private listeners = new Set<() => void>()
  private snapshot: CardReview[] = []
  private logSnapshot: ReviewLogEntry[] = []
  private undoSnapshot: ReviewUndo[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private flushing = false
  private started = false
  private qc: QueryClient | null = null

  start(userId: number, qc: QueryClient) {
    this.qc = qc
    if (this.started) return
    this.started = true
    this.storageKey = `noted:reviews:${userId}`
    this.load()
    this.emit()
    window.addEventListener('storage', (e) => {
      if (e.key !== this.storageKey) return
      this.load()
      this.emit()
    })
    window.addEventListener('online', () => void this.flush())
    document.addEventListener('visibilitychange', () => void this.flush())
    setInterval(() => void this.flush(), RETRY_INTERVAL)
    setTimeout(() => void this.flush(), 800)
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  /** Alle lokal bekannten Bewertungen (gesendet und ungesendet) */
  getSnapshot = () => this.snapshot

  /** Noch nicht gesendete Einträge fürs Bewertungsprotokoll – z. B. für „Heute vergessen“, bevor der Server sie kennt */
  getLog = () => this.logSnapshot

  /** Alle lokal bekannten Rücknahmen, die die Daten vom Server womöglich noch nicht enthalten (für `applyUndos`) */
  getUndoSnapshot = () => this.undoSnapshot

  private emit() {
    this.snapshot = [...this.acked.values(), ...this.pending.values()]
    this.logSnapshot = [...this.log.values()]
    this.undoSnapshot = [...this.undone.values(), ...this.undoing.values()]
    for (const fn of this.listeners) fn()
  }

  private read(): Stored {
    try {
      const raw = JSON.parse(localStorage.getItem(this.storageKey) ?? 'null')
      return {
        pending: raw?.pending ?? [],
        acked: raw?.acked ?? [],
        log: raw?.log ?? [],
        undo: raw?.undo ?? [],
        undone: raw?.undone ?? [],
      }
    } catch {
      return { pending: [], acked: [], log: [], undo: [], undone: [] }
    }
  }

  /** Stand aus dem Speicher (z. B. von einem anderen Tab) übernehmen – pro Kartenseite gewinnt die jüngste Bewertung. */
  private load() {
    const stored = this.read()
    // Rücknahmen zuerst – sie gelten auch für Bewertungen, die dieser Tab schon vorher geladen hat
    for (const [list, map] of [
      [stored.undo, this.undoing],
      [stored.undone, this.undone],
    ] as const) {
      for (const u of list) {
        const key = ratingKey(u)
        if (this.settledUndo.has(key) || this.undoing.has(key) || this.undone.has(key)) continue
        map.set(key, u)
        this.revoke(u)
      }
    }
    const keep = (r: CardReview) =>
      !this.dropped.has(r.cardId) &&
      !this.revoked.has(ratingKey(r)) &&
      (this.forgotten.get(reviewKey(r.cardId, r.side)) ?? -1) < r.reviewedAt
    for (const r of stored.acked) if (keep(r)) upsert(this.acked, r)
    for (const r of stored.pending) if (keep(r)) upsert(this.pending, r)
    for (const e of stored.log) {
      const key = ratingKey(e)
      if (!this.sentLog.has(key) && !this.revoked.has(key) && !this.log.has(key)) this.log.set(key, e)
    }
    // Ältere Einträge fallen weg, falls lange nichts gesendet werden konnte
    for (const key of this.log.keys()) {
      if (this.log.size <= MAX_LOG) break
      this.log.delete(key)
    }
    // Was ein anderer Tab schon gesendet hat, nicht noch einmal senden
    for (const [key, r] of this.pending) {
      const sent = this.acked.get(key)
      if (sent && sent.reviewedAt >= r.reviewedAt) this.pending.delete(key)
    }
  }

  private persist() {
    if (!this.storageKey) return
    this.load()
    try {
      const stored: Stored = {
        pending: [...this.pending.values()],
        acked: [...this.acked.values()],
        log: [...this.log.values()],
        undo: [...this.undoing.values()],
        undone: [...this.undone.values()],
      }
      if (Object.values(stored).every((list) => list.length === 0)) localStorage.removeItem(this.storageKey)
      else localStorage.setItem(this.storageKey, JSON.stringify(stored))
    } catch {
      /* voll – bleibt im Arbeitsspeicher und wird beim nächsten Versuch gesendet */
    }
  }

  /** Neuer Lernstand einer Kartenseite – `entry`: die Bewertung fürs Protokoll */
  add(review: CardReview, entry?: ReviewLogEntry) {
    this.dropped.delete(review.cardId)
    this.pending.set(reviewKey(review.cardId, review.side), review)
    if (entry) this.log.set(ratingKey(entry), entry)
    this.persist()
    this.emit()
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), FLUSH_DELAY)
  }

  /**
   * Bewertung zurücknehmen („Rückgängig“ beim Lernen): Lokal gilt sofort wieder der Stand davor. Die Rücknahme wird
   * immer gesendet (offline später) – auch wenn die Bewertung selbst noch nicht unterwegs war, denn ein anderer Tab
   * könnte sie schon gesendet haben.
   */
  undo(u: ReviewUndo) {
    this.revoke(u)
    // War der Stand davor noch nicht gesendet, hat ihn die Bewertung in der Warteschlange ersetzt. Kennt der Server
    // ihn schon, verwirft er ihn als nicht neuer.
    if (u.previous) upsert(this.pending, { cardId: u.cardId, side: u.side, ...u.previous })
    this.undoing.set(ratingKey(u), u)
    this.persist()
    this.emit()
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), FLUSH_DELAY)
  }

  /** Eine Bewertung aus Lernstand und Protokoll nehmen – und sie auch nicht aus dem Speicher zurückholen */
  private revoke(u: ReviewUndo) {
    const key = ratingKey(u)
    this.revoked.add(key)
    this.log.delete(key)
    const side = reviewKey(u.cardId, u.side)
    for (const map of [this.pending, this.acked]) if (map.get(side)?.reviewedAt === u.reviewedAt) map.delete(side)
  }

  /** Bewertungen bestimmter Karten verwerfen (Karte gelöscht, Lernstand zurückgesetzt) */
  drop(cardIds: Set<string>) {
    for (const id of cardIds) this.dropped.add(id)
    for (const map of [this.pending, this.acked]) {
      for (const [key, r] of map) if (cardIds.has(r.cardId)) map.delete(key)
    }
    this.persist()
    this.emit()
  }

  /**
   * Seiten einer bearbeiteten Karte umnummerieren wie auf dem Server (`sideMap` aus `remapSides`): Bewertungen ziehen
   * mit ihrer Lücke bzw. Fläche um, die weggefallener Seiten entfallen.
   */
  remap(cardId: string, sideMap: (Side | null)[]) {
    const moved = movedSides(sideMap)
    let changed = false
    for (const map of [this.pending, this.acked]) {
      const keep: CardReview[] = []
      for (const [key, r] of map) {
        if (r.cardId !== cardId || moved.get(r.side) === r.side) continue
        this.forget(map, key, r)
        const side = moved.get(r.side)
        if (side !== undefined) keep.push({ ...r, side })
        changed = true
      }
      for (const r of keep) upsert(map, r)
    }
    for (const [key, e] of [...this.log]) {
      if (e.cardId !== cardId || moved.get(e.side) === e.side) continue
      this.log.delete(key)
      this.sentLog.add(key)
      const side = moved.get(e.side)
      if (side !== undefined) this.log.set(ratingKey({ ...e, side }), { ...e, side })
      changed = true
    }
    if (!changed) return
    this.persist()
    this.emit()
  }

  /**
   * Nach dem Laden vom Server: gesendete Bewertungen, die der Server schon kennt (oder die zu gelöschten Karten
   * gehören), werden als Überlagerung nicht mehr gebraucht. Kommt die Antwort aus dem Offline-Cache, ist sie älter
   * und es bleibt alles stehen.
   */
  prune(data: FlashcardData) {
    if (this.acked.size === 0 && this.undone.size === 0) return
    const server = new Map(data.reviews.map((r) => [reviewKey(r.cardId, r.side), r]))
    const sides = new Map(data.cards.map((c) => [c.id, sidesOf(c).length]))
    let changed = false
    for (const [key, r] of this.acked) {
      const known = server.get(key)
      const count = sides.get(r.cardId) ?? 0
      if (r.side >= count || (known && known.reviewedAt >= r.reviewedAt)) {
        this.forget(this.acked, key, r)
        changed = true
      }
    }
    // Gesendete Rücknahmen: erledigt, sobald der Server die Bewertung nicht mehr als Stand führt
    for (const [key, u] of this.undone) {
      if (server.get(reviewKey(u.cardId, u.side))?.reviewedAt === u.reviewedAt) continue
      this.undone.delete(key)
      this.settledUndo.add(key)
      changed = true
    }
    if (changed) {
      this.persist()
      this.emit()
    }
  }

  async flush(): Promise<void> {
    if (!this.storageKey || this.flushing) return
    this.load()
    if (this.pending.size === 0 && this.log.size === 0 && this.undoing.size === 0) return
    this.flushing = true
    try {
      // In Blöcken, bis nichts mehr aussteht – auch was während des Sendens neu bewertet wurde. Rücknahmen gehen mit
      // den Bewertungen, die der Server nach ihnen übernimmt.
      while (this.pending.size > 0 || this.log.size > 0 || this.undoing.size > 0) {
        const batch = [...this.pending.values()].slice(0, REVIEW_BATCH)
        const logBatch = [...this.log.values()].slice(0, LOG_BATCH)
        const undo = [...this.undoing.values()].slice(0, LOG_BATCH)
        try {
          await api('/api/reviews', {
            method: 'POST',
            body: { reviews: batch, log: logBatch, ...(undo.length ? { undo } : {}) },
          })
          this.settleUndo(undo, true)
          this.settleLog(logBatch)
          this.settle(batch, true)
        } catch (err) {
          // Offline oder Serverfehler: später erneut. Als ungültig abgelehnt: verwerfen, sonst hinge es ewig fest.
          if (err instanceof ApiError && (err.status === 400 || err.status === 413)) {
            this.settleUndo(undo, false)
            this.settleLog(logBatch)
            this.settle(batch, false)
            continue
          }
          return
        }
      }
    } finally {
      this.flushing = false
    }
  }

  /** Gesendete Bewertungen aus der Warteschlange nehmen (nur, was seitdem nicht erneut bewertet wurde). */
  private settle(batch: CardReview[], sent: boolean) {
    if (sent) {
      this.qc?.setQueryData<FlashcardData>(flashcardsKey, (d) => (d ? { ...d, reviews: mergeReviews(d.reviews, batch) } : d))
    }
    for (const r of batch) {
      const key = reviewKey(r.cardId, r.side)
      if (this.pending.get(key) !== r) continue
      if (sent) {
        this.pending.delete(key)
        upsert(this.acked, r)
      } else this.forget(this.pending, key, r)
    }
    this.persist()
    this.emit()
  }

  /** Gesendete Rücknahmen bleiben als Überlagerung (siehe `prune`), abgelehnte entfallen */
  private settleUndo(list: ReviewUndo[], sent: boolean) {
    if (list.length === 0) return
    if (sent) this.qc?.setQueryData<FlashcardData>(flashcardsKey, (d) => (d ? { ...d, reviews: applyUndos(d.reviews, list) } : d))
    for (const u of list) {
      const key = ratingKey(u)
      this.undoing.delete(key)
      if (sent) this.undone.set(key, u)
      else this.settledUndo.add(key)
    }
  }

  /** Gesendete (oder abgelehnte) Protokolleinträge nicht noch einmal senden */
  private settleLog(entries: ReviewLogEntry[]) {
    for (const e of entries) {
      const key = ratingKey(e)
      this.log.delete(key)
      this.sentLog.add(key)
    }
  }

  private forget(map: Map<string, CardReview>, key: string, r: CardReview) {
    map.delete(key)
    this.forgotten.set(key, Math.max(this.forgotten.get(key) ?? -1, r.reviewedAt))
  }

  clearAll() {
    this.pending.clear()
    this.acked.clear()
    this.log.clear()
    this.undoing.clear()
    this.undone.clear()
    if (this.storageKey) localStorage.removeItem(this.storageKey)
    this.emit()
  }
}

export const reviewQueue = new ReviewQueue()

function mergeReviews(base: CardReview[], updates: CardReview[]): CardReview[] {
  const map = new Map(base.map((r) => [reviewKey(r.cardId, r.side), r]))
  for (const r of updates) {
    const key = reviewKey(r.cardId, r.side)
    const cur = map.get(key)
    if (!cur || cur.reviewedAt <= r.reviewedAt) map.set(key, r)
  }
  return [...map.values()]
}

/**
 * Zurückgenommene Bewertungen durch den Stand davor ersetzen – je Kartenseite die jüngste zuerst, damit mehrfaches
 * Rückgängig bis zum Anfang reicht. Steht eine Seite schon auf einem anderen Stand, bleibt sie.
 */
export function applyUndos(reviews: CardReview[], undos: ReviewUndo[]): CardReview[] {
  if (undos.length === 0) return reviews
  const map = new Map(reviews.map((r) => [reviewKey(r.cardId, r.side), r]))
  for (const u of [...undos].sort((a, b) => b.reviewedAt - a.reviewedAt)) {
    const key = reviewKey(u.cardId, u.side)
    if (map.get(key)?.reviewedAt !== u.reviewedAt) continue
    if (u.previous) map.set(key, { cardId: u.cardId, side: u.side, ...u.previous })
    else map.delete(key)
  }
  return [...map.values()]
}

export type Flashcards = FlashcardData & { states: StateMap }

const NO_PENDING: CardReview[] = []
const NO_UNDO: ReviewUndo[] = []

/** Stapel (mit ihren Klausuren), Karten und Lernstand (inkl. noch nicht gesendeter Bewertungen). */
export function useFlashcards() {
  const query = useQuery({
    queryKey: flashcardsKey,
    queryFn: async () => {
      const data = await api<FlashcardData>('/api/flashcards')
      reviewQueue.prune(data)
      return data
    },
  })
  const pending = useSyncExternalStore(reviewQueue.subscribe, reviewQueue.getSnapshot, () => NO_PENDING)
  const undos = useSyncExternalStore(reviewQueue.subscribe, reviewQueue.getUndoSnapshot, () => NO_UNDO)
  const { data: events } = useEvents()
  const data = useMemo<Flashcards | null>(() => {
    if (!query.data) return null
    const reviews = applyUndos(pending.length ? mergeReviews(query.data.reviews, pending) : query.data.reviews, undos)
    const exams = examsByDeck(events ?? [])
    const decks = exams.size ? query.data.decks.map((d) => ({ ...d, exams: exams.get(d.id) })) : query.data.decks
    return { ...query.data, decks, reviews, states: stateMap(reviews) }
  }, [query.data, pending, undos, events])
  return { ...query, data }
}

const NO_LOG: ReviewLogEntry[] = []

/**
 * Kartenseiten (reviewKey), die heute mit „Nochmal“ bewertet wurden – vom Server und die noch nicht gesendeten dieses
 * Geräts. `offline`: Der Server war nicht erreichbar, es zählen nur die lokalen.
 */
export function useAgainToday(enabled = true) {
  const query = useQuery({
    queryKey: ['again-today'],
    queryFn: () =>
      api<{ sides: { cardId: string; side: Side }[] }>(`/api/stats/again?tz=${encodeURIComponent(deviceTimeZone())}`),
    enabled,
    staleTime: 0,
    retry: false,
  })
  const log = useSyncExternalStore(reviewQueue.subscribe, reviewQueue.getLog, () => NO_LOG)
  // Nach Mitternacht beginnt ein neuer Tag
  const today = startOfDay(useNow())
  const keys = useMemo(() => {
    const set = new Set((query.data?.sides ?? []).map((s) => reviewKey(s.cardId, s.side)))
    for (const e of log) if (e.rating === 1 && e.reviewedAt >= today) set.add(reviewKey(e.cardId, e.side))
    return set
  }, [query.data, log, today])
  return { keys, loading: enabled && query.isPending && !query.isError, offline: query.isError }
}

// ---------------------------------------------------------------------------
// Änderungen (nur online)
// ---------------------------------------------------------------------------

function patch(qc: QueryClient, fn: (d: FlashcardData) => FlashcardData) {
  qc.setQueryData<FlashcardData>(flashcardsKey, (d) => (d ? fn(d) : d))
}

/**
 * Zur Problemkarte geworden und der Stapel setzt sie aus: im Browser gleich als ausgesetzt zeigen – der Server setzt
 * sie selbst aus, sobald die Bewertung ankommt (auch offline gesammelt)
 */
export function markSuspended(qc: QueryClient, cardId: string) {
  patch(qc, (d) => ({ ...d, cards: d.cards.map((c) => (c.id === cardId ? { ...c, suspended: true } : c)) }))
}

const byName = (a: Deck, b: Deck) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' })

type DeckInput = Partial<
  Pick<
    Deck,
    | 'description'
    | 'newPerDay'
    | 'typeAnswer'
    | 'scheduler'
    | 'retention'
    | 'learningSteps'
    | 'relearningSteps'
    | 'reviewPerDay'
    | 'leechLapses'
    | 'leechAction'
  >
> & { name: string }

export async function createDeck(qc: QueryClient, input: DeckInput): Promise<Deck> {
  const { deck } = await api<{ deck: Deck }>('/api/decks', { method: 'POST', body: input })
  patch(qc, (d) => ({ ...d, decks: [...d.decks, deck].sort(byName) }))
  return deck
}

export async function updateDeck(qc: QueryClient, id: string, input: Partial<DeckInput>): Promise<Deck> {
  const { deck } = await api<{ deck: Deck }>(`/api/decks/${id}`, { method: 'PATCH', body: input })
  patch(qc, (d) => ({ ...d, decks: d.decks.map((x) => (x.id === id ? deck : x)).sort(byName) }))
  return deck
}

export async function deleteDeck(qc: QueryClient, id: string) {
  await api(`/api/decks/${id}`, { method: 'DELETE' })
  patch(qc, (d) => {
    const gone = new Set(d.cards.filter((c) => c.deckId === id).map((c) => c.id))
    reviewQueue.drop(gone)
    return {
      ...d,
      decks: d.decks.filter((x) => x.id !== id),
      cards: d.cards.filter((c) => !gone.has(c.id)),
      reviews: d.reviews.filter((r) => !gone.has(r.cardId)),
    }
  })
}

/** FSRS-Gewichte aus dem eigenen Lernverlauf schätzen (auf dem Server, Tage in der Zeitzone dieses Geräts) */
export async function optimizeFsrs(qc: QueryClient): Promise<FsrsOptimizeResult> {
  const result = await api<FsrsOptimizeResult>('/api/flashcards/fsrs', {
    method: 'POST',
    body: { timeZone: deviceTimeZone() },
  })
  patch(qc, (d) => ({ ...d, fsrs: result.fsrs }))
  return result
}

/** Zurück zu den Standardwerten von FSRS */
export async function resetFsrs(qc: QueryClient) {
  await api('/api/flashcards/fsrs', { method: 'DELETE' })
  patch(qc, (d) => ({ ...d, fsrs: null }))
}

export async function resetDeckProgress(qc: QueryClient, id: string) {
  await api(`/api/decks/${id}/progress`, { method: 'DELETE' })
  patch(qc, (d) => {
    const ids = new Set(d.cards.filter((c) => c.deckId === id).map((c) => c.id))
    reviewQueue.drop(ids)
    return { ...d, reviews: d.reviews.filter((r) => !ids.has(r.cardId)) }
  })
}

export type CardInput = {
  type: CardType
  front: string
  back: string
  options: CardOption[]
  occlusion?: Occlusion | null
  noteId?: string | null
}

export async function createCards(qc: QueryClient, deckId: string, cards: CardInput[]): Promise<Card[]> {
  const res = await api<{ cards: Card[] }>(`/api/decks/${deckId}/cards`, { method: 'POST', body: { cards } })
  patch(qc, (d) => ({ ...d, cards: [...d.cards, ...res.cards] }))
  return res.cards
}

export async function updateCard(
  qc: QueryClient,
  id: string,
  input: Partial<CardInput> & { deckId?: string; suspended?: boolean },
): Promise<Card> {
  const { card, sideMap } = await api<CardUpdateResult>(`/api/cards/${id}`, { method: 'PATCH', body: input })
  // Der Lernstand zieht mit seiner Lücke bzw. Fläche um, weggefallene Seiten verlieren ihn – wie auf dem Server
  reviewQueue.remap(id, sideMap)
  const moved = movedSides(sideMap)
  patch(qc, (d) => ({
    ...d,
    cards: d.cards.map((c) => (c.id === id ? card : c)),
    reviews: d.reviews.flatMap((r) => {
      if (r.cardId !== id) return [r]
      const side = moved.get(r.side)
      return side === undefined ? [] : [{ ...r, side }]
    }),
  }))
  return card
}

/** Karte neu lernen: Lernstand zurücksetzen und Aussetzen aufheben */
export async function resetCardProgress(qc: QueryClient, id: string): Promise<Card> {
  const { card } = await api<{ card: Card }>(`/api/cards/${id}/progress`, { method: 'DELETE' })
  reviewQueue.drop(new Set([id]))
  patch(qc, (d) => ({ ...d, cards: d.cards.map((c) => (c.id === id ? card : c)), reviews: d.reviews.filter((r) => r.cardId !== id) }))
  return card
}

/** Anki-Paket importieren – danach Stapel und Karten neu laden */
export async function importAnki(qc: QueryClient, file: File, progress: boolean): Promise<AnkiImportResult> {
  const form = new FormData()
  form.append('file', file)
  if (progress) form.append('progress', '1')
  const result = await api<AnkiImportResult>('/api/flashcards/anki', { method: 'POST', form })
  await qc.invalidateQueries({ queryKey: flashcardsKey })
  return result
}

/** Stapel-Datei (.noted-deck.zip) importieren – als neuer Stapel oder in `deckId` */
export async function importDeckPackage(qc: QueryClient, file: File, deckId: string | null): Promise<DeckImportResult> {
  const form = new FormData()
  form.append('file', file)
  if (deckId) form.append('deckId', deckId)
  const result = await api<DeckImportResult>('/api/decks/import', { method: 'POST', form })
  await qc.invalidateQueries({ queryKey: flashcardsKey })
  return result
}

/**
 * Mehrere Karten auf einmal verschieben (`deckId`), aussetzen, fortsetzen, neu lernen oder löschen. Liefert die IDs,
 * die der Server geändert hat.
 */
export async function batchCards(qc: QueryClient, action: CardBatchAction, ids: string[], deckId?: string): Promise<string[]> {
  const res = await api<CardBatchResult>('/api/cards/batch', { method: 'POST', body: { action, ids, deckId } })
  const done = new Set(res.ids)
  // Gelöscht oder neu zu lernen: auch noch nicht gesendete Bewertungen verwerfen
  if (action === 'delete' || action === 'reset') reviewQueue.drop(done)
  const changed = new Map(res.cards.map((c) => [c.id, c]))
  patch(qc, (d) => ({
    ...d,
    cards: d.cards.flatMap((c) => (action === 'delete' && done.has(c.id) ? [] : [changed.get(c.id) ?? c])),
    reviews: action === 'delete' || action === 'reset' ? d.reviews.filter((r) => !done.has(r.cardId)) : d.reviews,
  }))
  return res.ids
}

export async function deleteCard(qc: QueryClient, id: string) {
  await api(`/api/cards/${id}`, { method: 'DELETE' })
  reviewQueue.drop(new Set([id]))
  patch(qc, (d) => ({ ...d, cards: d.cards.filter((c) => c.id !== id), reviews: d.reviews.filter((r) => r.cardId !== id) }))
}

export const CARD_TYPE_LABELS: Record<CardType, string> = {
  basic: 'Grundkarte',
  reversed: 'Beidseitig',
  mc: 'Multiple Choice',
  cloze: 'Lückentext',
  occlusion: 'Bildverdeckung',
}
