'use client'
// Karteikarten im Browser: Daten laden, Änderungen an den Server schicken und Bewertungen aus Lernsitzungen
// lokal sammeln. Bewertungen funktionieren auch offline – sie liegen bis zum Senden im localStorage, zusammen mit
// ihrem Eintrag fürs Bewertungsprotokoll (Statistik).

import { useMemo, useSyncExternalStore } from 'react'
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { api, ApiError, NetworkError } from '@/shared/client/api'
import { reviewKey, sidesOf, stateMap, type StateMap } from '../study'
import type { AnkiImportResult, Card, CardOption, CardReview, CardType, Deck, FlashcardData, ReviewLogEntry } from '../types'

const flashcardsKey = ['flashcards'] as const

const FLUSH_DELAY = 1500
const RETRY_INTERVAL = 30_000
/** Höchstens so viele Protokolleinträge pro Anfrage bzw. im Speicher (älteste fallen zuerst weg) */
const LOG_BATCH = 5000
const MAX_LOG = 20_000

type Stored = { pending: CardReview[]; acked: CardReview[]; log?: ReviewLogEntry[] }

const logKey = (e: ReviewLogEntry) => `${e.cardId}:${e.side}:${e.reviewedAt}`

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
 * Mehrere Tabs teilen sich den Speicher und führen ihren Stand zusammen. Doppelt gesendete Protokolleinträge
 * verwirft der Server.
 */
export class ReviewQueue {
  private storageKey = ''
  private pending = new Map<string, CardReview>()
  private acked = new Map<string, CardReview>()
  private log = new Map<string, ReviewLogEntry>()
  /** In dieser Sitzung gesendete Protokolleinträge – nicht aus dem Speicher eines anderen Tabs zurückholen */
  private sentLog = new Set<string>()
  /** In dieser Sitzung verworfene Karten (gelöscht, Lernstand zurückgesetzt) – nicht aus anderen Tabs zurückholen */
  private dropped = new Set<string>()
  /** Erledigte Einträge je Kartenseite (bis zu diesem Zeitpunkt) – nicht aus dem Speicher zurückholen */
  private forgotten = new Map<string, number>()
  private listeners = new Set<() => void>()
  private snapshot: CardReview[] = []
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

  private emit() {
    this.snapshot = [...this.acked.values(), ...this.pending.values()]
    for (const fn of this.listeners) fn()
  }

  private read(): Stored {
    try {
      const raw = JSON.parse(localStorage.getItem(this.storageKey) ?? 'null')
      if (Array.isArray(raw)) return { pending: raw, acked: [] } // älteres Format
      return { pending: raw?.pending ?? [], acked: raw?.acked ?? [], log: Array.isArray(raw?.log) ? raw.log : [] }
    } catch {
      return { pending: [], acked: [] }
    }
  }

  /** Stand aus dem Speicher (z. B. von einem anderen Tab) übernehmen – pro Kartenseite gewinnt die jüngste Bewertung. */
  private load() {
    const stored = this.read()
    const keep = (r: CardReview) =>
      !this.dropped.has(r.cardId) && (this.forgotten.get(reviewKey(r.cardId, r.side)) ?? -1) < r.reviewedAt
    for (const r of stored.acked) if (keep(r)) upsert(this.acked, r)
    for (const r of stored.pending) if (keep(r)) upsert(this.pending, r)
    for (const e of stored.log ?? []) {
      const key = logKey(e)
      if (!this.sentLog.has(key) && !this.log.has(key)) this.log.set(key, e)
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
      if (this.pending.size === 0 && this.acked.size === 0 && this.log.size === 0) localStorage.removeItem(this.storageKey)
      else {
        const stored: Stored = { pending: [...this.pending.values()], acked: [...this.acked.values()], log: [...this.log.values()] }
        localStorage.setItem(this.storageKey, JSON.stringify(stored))
      }
    } catch {
      /* voll – bleibt im Arbeitsspeicher und wird beim nächsten Versuch gesendet */
    }
  }

  /** Neuer Lernstand einer Kartenseite – `entry`: die Bewertung fürs Protokoll */
  add(review: CardReview, entry?: ReviewLogEntry) {
    this.dropped.delete(review.cardId)
    this.pending.set(reviewKey(review.cardId, review.side), review)
    if (entry) this.log.set(logKey(entry), entry)
    this.persist()
    this.emit()
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), FLUSH_DELAY)
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
   * Nach dem Laden vom Server: gesendete Bewertungen, die der Server schon kennt (oder die zu gelöschten Karten
   * gehören), werden als Überlagerung nicht mehr gebraucht. Kommt die Antwort aus dem Offline-Cache, ist sie älter
   * und es bleibt alles stehen.
   */
  prune(data: FlashcardData) {
    if (this.acked.size === 0) return
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
    if (changed) {
      this.persist()
      this.emit()
    }
  }

  async flush(): Promise<void> {
    if (!this.storageKey || this.flushing) return
    this.load()
    if (this.pending.size === 0 && this.log.size === 0) return
    this.flushing = true
    const batch = [...this.pending.values()]
    const logBatch = [...this.log.values()].slice(0, LOG_BATCH)
    try {
      await api('/api/reviews', { method: 'POST', body: { reviews: batch, log: logBatch } })
      this.settleLog(logBatch)
      this.settle(batch, true)
      // Während des Sendens neu bewertete Karten gleich hinterherschicken
      if (this.pending.size > 0 || this.log.size > 0) {
        clearTimeout(this.timer)
        this.timer = setTimeout(() => void this.flush(), FLUSH_DELAY)
      }
    } catch (err) {
      // Offline oder Serverfehler: später erneut. Als ungültig abgelehnt: verwerfen, sonst hinge es ewig fest.
      if (!(err instanceof NetworkError) && err instanceof ApiError && (err.status === 400 || err.status === 413)) {
        this.settleLog(logBatch)
        this.settle(batch, false)
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

  /** Gesendete (oder abgelehnte) Protokolleinträge nicht noch einmal senden */
  private settleLog(entries: ReviewLogEntry[]) {
    for (const e of entries) {
      const key = logKey(e)
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

export type Flashcards = FlashcardData & { states: StateMap }

const NO_PENDING: CardReview[] = []

/** Stapel, Karten und Lernstand (inkl. noch nicht gesendeter Bewertungen). */
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
  const data = useMemo<Flashcards | null>(() => {
    if (!query.data) return null
    const reviews = pending.length ? mergeReviews(query.data.reviews, pending) : query.data.reviews
    return { ...query.data, reviews, states: stateMap(reviews) }
  }, [query.data, pending])
  return { ...query, data }
}

// ---------------------------------------------------------------------------
// Änderungen (nur online)
// ---------------------------------------------------------------------------

function patch(qc: QueryClient, fn: (d: FlashcardData) => FlashcardData) {
  qc.setQueryData<FlashcardData>(flashcardsKey, (d) => (d ? fn(d) : d))
}

const byName = (a: Deck, b: Deck) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' })

export type DeckInput = { name: string; description?: string; newPerDay?: number; typeAnswer?: boolean }

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
      decks: d.decks.filter((x) => x.id !== id),
      cards: d.cards.filter((c) => !gone.has(c.id)),
      reviews: d.reviews.filter((r) => !gone.has(r.cardId)),
    }
  })
}

export async function resetDeckProgress(qc: QueryClient, id: string) {
  await api(`/api/decks/${id}/progress`, { method: 'DELETE' })
  patch(qc, (d) => {
    const ids = new Set(d.cards.filter((c) => c.deckId === id).map((c) => c.id))
    reviewQueue.drop(ids)
    return { ...d, reviews: d.reviews.filter((r) => !ids.has(r.cardId)) }
  })
}

export type CardInput = { type: CardType; front: string; back: string; options: CardOption[]; noteId?: string | null }

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
  const { card } = await api<{ card: Card }>(`/api/cards/${id}`, { method: 'PATCH', body: input })
  // Weggefallene Seiten (aus beidseitig wird einseitig, Lücke gelöscht) verlieren ihren Lernstand – wie auf dem Server
  const sides = sidesOf(card).length
  patch(qc, (d) => ({
    ...d,
    cards: d.cards.map((c) => (c.id === id ? card : c)),
    reviews: d.reviews.filter((r) => r.cardId !== id || r.side < sides),
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
}
