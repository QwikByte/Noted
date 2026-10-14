import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueryClient } from '@tanstack/react-query'
import { schedule } from '@/lib/shared/srs'
import type { CardReview, FlashcardData } from '@/lib/shared/types'

// Browser-Umgebung für die Warteschlange nachbilden (localStorage, Ereignisse)
const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
})
vi.stubGlobal('window', { addEventListener: () => {} })
vi.stubGlobal('document', { addEventListener: () => {} })

const { ReviewQueue } = await import('@/lib/client/flashcards')

const KEY = 'noted:reviews:1'
const qc = { setQueryData: () => {} } as unknown as QueryClient
const review = (cardId: string, at: number): CardReview => ({ cardId, side: 0, ...schedule(null, 3, at) })
const stored = () => JSON.parse(store.get(KEY) ?? '{"pending":[],"acked":[]}') as { pending: CardReview[]; acked: CardReview[] }
const ok = () => new Response(JSON.stringify({ saved: 1 }), { status: 200, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  store.clear()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

function started() {
  const q = new ReviewQueue()
  q.start(1, qc)
  return q
}

describe('Warteschlange für Bewertungen', () => {
  it('behält offline gesammelte Bewertungen und sendet sie später', async () => {
    const q = started()
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(ok())
    vi.stubGlobal('fetch', fetchMock)
    q.add(review('a', 1000))
    await q.flush()
    expect(stored().pending).toHaveLength(1)
    await q.flush()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // Gesendet, bleibt aber als Überlagerung, bis die Serverdaten sie enthalten
    expect(stored()).toMatchObject({ pending: [], acked: [{ cardId: 'a' }] })
    expect(q.getSnapshot().map((r) => r.cardId)).toEqual(['a'])
  })

  it('verwirft die Überlagerung erst, wenn der Server die Bewertung kennt', async () => {
    const q = started()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()))
    const r = review('a', 5000)
    q.add(r)
    await q.flush()
    const data = (reviews: CardReview[]): FlashcardData => ({
      decks: [],
      cards: [{ id: 'a', deckId: 'd', noteId: null, type: 'basic', front: 'f', back: 'b', options: [], position: 0, createdAt: 0, updatedAt: 0 }],
      reviews,
    })
    // Veraltete Daten (z. B. aus dem Offline-Cache): Überlagerung bleibt
    q.prune(data([review('a', 1000)]))
    expect(q.getSnapshot()).toHaveLength(1)
    q.prune(data([r]))
    expect(q.getSnapshot()).toHaveLength(0)
    expect(store.has(KEY)).toBe(false)
  })

  it('überschreibt keine Bewertungen aus einem anderen Tab', () => {
    const q = started()
    q.add(review('a', 1000))
    // Ein anderer Tab hat inzwischen eigene Bewertungen gespeichert
    store.set(KEY, JSON.stringify({ pending: [...stored().pending, review('b', 2000)], acked: [] }))
    q.add(review('c', 3000))
    expect(stored().pending.map((r) => r.cardId).sort()).toEqual(['a', 'b', 'c'])
  })

  it('verwirft vom Server abgelehnte Bewertungen, behält sie aber bei Anmelde- oder Serverproblemen', async () => {
    const q = started()
    const reject = (status: number) => new Response(JSON.stringify({ error: 'x', message: 'x' }), { status, headers: { 'content-type': 'application/json' } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reject(500)).mockResolvedValueOnce(reject(400)))
    q.add(review('a', 1000))
    await q.flush()
    expect(stored().pending).toHaveLength(1)
    await q.flush()
    expect(store.has(KEY)).toBe(false)
  })

  it('holt verworfene Karten nicht aus dem Speicher zurück', () => {
    const q = started()
    q.add(review('a', 1000))
    q.add(review('b', 1000))
    q.drop(new Set(['a']))
    expect(stored().pending.map((r) => r.cardId)).toEqual(['b'])
    expect(q.getSnapshot().map((r) => r.cardId)).toEqual(['b'])
  })
})
