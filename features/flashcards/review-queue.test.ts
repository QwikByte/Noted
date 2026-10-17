import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueryClient } from '@tanstack/react-query'
import { schedule } from './srs'
import type { CardReview, FlashcardData } from './types'

// Browser-Umgebung für die Warteschlange nachbilden (localStorage, Ereignisse)
const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
})
vi.stubGlobal('window', { addEventListener: () => {} })
vi.stubGlobal('document', { addEventListener: () => {} })

const { ReviewQueue } = await import('./client/flashcards')

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
      cards: [{ id: 'a', deckId: 'd', noteId: null, type: 'basic', front: 'f', back: 'b', options: [], occlusion: null, position: 0, suspended: false, createdAt: 0, updatedAt: 0 }],
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

describe('Bewertungsprotokoll in der Warteschlange', () => {
  const entry = (cardId: string, at: number) => ({
    cardId,
    side: 0 as const,
    rating: 3 as const,
    phase: 'new' as const,
    intervalBefore: 0,
    intervalAfter: 0.007,
    durationMs: 4000,
    reviewedAt: at,
  })
  const storedLog = () => (JSON.parse(store.get(KEY) ?? '{}').log ?? []) as { reviewedAt: number }[]

  it('protokolliert jede Bewertung – auch mehrere derselben Karte – und sendet sie mit', async () => {
    const q = started()
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue(ok())
    vi.stubGlobal('fetch', fetchMock)
    q.add(review('a', 1000), entry('a', 1000))
    q.add(review('a', 61_000), entry('a', 61_000))
    await q.flush()
    // Offline: Lernstand nur der letzte, im Protokoll beide
    expect(stored().pending).toHaveLength(1)
    expect(storedLog().map((e) => e.reviewedAt)).toEqual([1000, 61_000])
    await q.flush()
    const body = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    expect(body.log.map((e: { reviewedAt: number }) => e.reviewedAt)).toEqual([1000, 61_000])
    expect(storedLog()).toEqual([])
  })

  it('holt gesendete Einträge nicht aus dem Speicher eines anderen Tabs zurück', async () => {
    const q = started()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()))
    q.add(review('a', 1000), entry('a', 1000))
    const old = store.get(KEY)!
    await q.flush()
    // Ein anderer Tab schreibt seinen älteren Stand zurück
    store.set(KEY, old)
    q.add(review('b', 2000), entry('b', 2000))
    expect(storedLog().map((e) => e.reviewedAt)).toEqual([2000])
  })
})
