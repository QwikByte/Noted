'use client'
// Karteikarten im Browser: Daten laden, Änderungen an den Server schicken und Bewertungen aus Lernsitzungen
// lokal sammeln. Bewertungen funktionieren auch offline – sie liegen bis zum Senden im localStorage.

import { useMemo, useSyncExternalStore } from 'react'
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { api, ApiError, NetworkError } from './api'
import { reviewKey, stateMap, type StateMap } from '@/lib/shared/study'
import type { Card, CardOption, CardReview, CardType, Deck, FlashcardData } from '@/lib/shared/types'

export const flashcardsKey = ['flashcards'] as const

const FLUSH_DELAY = 1500
const RETRY_INTERVAL = 30_000

class ReviewQueue {
  private storageKey = ''
  private pending = new Map<string, CardReview>()
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
    try {
      const list: CardReview[] = JSON.parse(localStorage.getItem(this.storageKey) ?? '[]')
      for (const r of list) this.pending.set(reviewKey(r.cardId, r.side), r)
    } catch {
      /* defekter Speicher – ignorieren */
    }
    this.emit()
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

  getSnapshot = () => this.snapshot

  private emit() {
    this.snapshot = [...this.pending.values()]
    for (const fn of this.listeners) fn()
  }

  private persist() {
    if (!this.storageKey) return
    try {
      if (this.pending.size === 0) localStorage.removeItem(this.storageKey)
      else localStorage.setItem(this.storageKey, JSON.stringify(this.snapshot))
    } catch {
      /* voll – bleibt im Arbeitsspeicher und wird beim nächsten Versuch gesendet */
    }
  }

  add(review: CardReview) {
    this.pending.set(reviewKey(review.cardId, review.side), review)
    this.emit()
    this.persist()
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), FLUSH_DELAY)
  }

  /** Bewertungen bestimmter Karten verwerfen (Karte gelöscht, Lernstand zurückgesetzt) */
  drop(cardIds: Set<string>) {
    let changed = false
    for (const [key, r] of this.pending) {
      if (cardIds.has(r.cardId)) {
        this.pending.delete(key)
        changed = true
      }
    }
    if (changed) {
      this.emit()
      this.persist()
    }
  }

  get size() {
    return this.pending.size
  }

  async flush(): Promise<void> {
    if (this.flushing || this.pending.size === 0) return
    this.flushing = true
    const batch = [...this.pending.values()]
    try {
      await api('/api/reviews', { method: 'POST', body: { reviews: batch } })
      this.settle(batch)
      // Während des Sendens neu bewertete Karten gleich hinterherschicken
      if (this.pending.size > 0) {
        clearTimeout(this.timer)
        this.timer = setTimeout(() => void this.flush(), FLUSH_DELAY)
      }
    } catch (err) {
      // Offline oder Serverfehler: später erneut. Als ungültig abgelehnt: verwerfen, sonst hinge es ewig fest.
      if (!(err instanceof NetworkError) && err instanceof ApiError && (err.status === 400 || err.status === 413)) {
        this.remove(batch)
      }
    } finally {
      this.flushing = false
    }
  }

  /** Gesendete Bewertungen in den Cache übernehmen und aus der Warteschlange nehmen. */
  private settle(batch: CardReview[]) {
    this.qc?.setQueryData<FlashcardData>(flashcardsKey, (d) => (d ? { ...d, reviews: mergeReviews(d.reviews, batch) } : d))
    this.remove(batch)
  }

  /** Nur entfernen, was seitdem nicht erneut bewertet wurde */
  private remove(batch: CardReview[]) {
    for (const r of batch) {
      const key = reviewKey(r.cardId, r.side)
      if (this.pending.get(key) === r) this.pending.delete(key)
    }
    this.emit()
    this.persist()
  }

  clearAll() {
    this.pending.clear()
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
    queryFn: () => api<FlashcardData>('/api/flashcards'),
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

export type DeckInput = { name: string; description?: string; newPerDay?: number }

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

export async function updateCard(qc: QueryClient, id: string, input: Partial<CardInput> & { deckId?: string }): Promise<Card> {
  const { card } = await api<{ card: Card }>(`/api/cards/${id}`, { method: 'PATCH', body: input })
  patch(qc, (d) => ({
    ...d,
    cards: d.cards.map((c) => (c.id === id ? card : c)),
    reviews: card.type === 'reversed' ? d.reviews : d.reviews.filter((r) => r.cardId !== id || r.side === 0),
  }))
  return card
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
}
