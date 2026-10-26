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

const { ReviewQueue, applyUndos } = await import('./client/flashcards')

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
      fsrs: null,
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

  it('sendet viele offline gesammelte Bewertungen in Blöcken – keine geht verloren', async () => {
    const q = started()
    const received: string[] = []
    // Wie der Server: mehr als 5000 Bewertungen je Anfrage lehnt er ab
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const { reviews } = JSON.parse(init.body as string) as { reviews: CardReview[] }
      if (reviews.length > 5000) return new Response('{"error":"invalid","message":"x"}', { status: 400, headers: { 'content-type': 'application/json' } })
      received.push(...reviews.map((r) => r.cardId))
      return ok()
    })
    // Eine Woche offline gelernt: über 5000 verschiedene Kartenseiten stehen aus
    store.set(KEY, JSON.stringify({ pending: Array.from({ length: 5001 }, (_, i) => review(`c${i}`, 1000 + i)), acked: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await q.flush()
    expect(new Set(received).size).toBe(5001)
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1)
    expect(stored().pending).toEqual([])
  })

  it('nummeriert ausstehende Bewertungen einer bearbeiteten Karte um', async () => {
    const q = started()
    const at = (side: number, t: number) => ({ ...review('a', t), side })
    // Eine noch nicht gesendete und eine gesendete Bewertung, dazu eine andere Karte
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()))
    q.add(at(2, 3000))
    await q.flush()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    q.add(at(0, 1000))
    q.add(at(1, 2000))
    q.add({ ...review('b', 4000), side: 1 })
    const before = store.get(KEY)!
    // Fläche 0 wurde gelöscht, eine neue kam ans Ende: 1 → 0, 2 → 1
    q.remap('a', [1, 2, null])
    const sides = (list: CardReview[]) => list.map((r) => `${r.cardId}:${r.side}:${r.reviewedAt}`).sort()
    expect(sides(stored().pending)).toEqual(['a:0:2000', 'b:1:4000'])
    expect(sides(stored().acked)).toEqual(['a:1:3000'])
    expect(sides(q.getSnapshot())).toEqual(['a:0:2000', 'a:1:3000', 'b:1:4000'])
    // Ein anderer Tab schreibt den alten Stand zurück: Die alten Nummern kommen nicht wieder
    store.set(KEY, before)
    q.add(review('c', 5000))
    expect(sides(stored().pending)).toEqual(['a:0:2000', 'b:1:4000', 'c:0:5000'])
    expect(sides(stored().acked)).toEqual(['a:1:3000'])
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

  it('nummeriert auch ausstehende Protokolleinträge um', () => {
    const q = started()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    q.add(review('a', 1000), entry('a', 1000))
    q.add({ ...review('a', 2000), side: 1 }, { ...entry('a', 2000), side: 1 })
    q.remap('a', [null, 0])
    const log = JSON.parse(store.get(KEY) ?? '{}').log as { side: number; reviewedAt: number }[]
    expect(log.map((e) => [e.side, e.reviewedAt])).toEqual([[1, 1000]])
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

describe('Bewertung zurücknehmen in der Warteschlange', () => {
  const entry = (cardId: string, at: number) => ({
    cardId,
    side: 0 as const,
    rating: 1 as const,
    phase: 'review' as const,
    intervalBefore: 1,
    intervalAfter: 0,
    durationMs: 4000,
    reviewedAt: at,
  })
  const storedAll = () => JSON.parse(store.get(KEY) ?? '{}') as { pending?: CardReview[]; log?: { reviewedAt: number }[]; undo?: unknown[] }
  const data = (reviews: CardReview[]): FlashcardData => ({
    decks: [],
    cards: [{ id: 'a', deckId: 'd', noteId: null, type: 'basic', front: 'f', back: 'b', options: [], occlusion: null, position: 0, suspended: false, createdAt: 0, updatedAt: 0 }],
    reviews,
    fsrs: null,
  })

  it('vor dem Senden: Der Stand davor gilt wieder und geht mit der Rücknahme in einer Anfrage raus', async () => {
    const q = started()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    const previous = schedule(null, 4, 1000)
    const first: CardReview = { cardId: 'a', side: 0, ...previous }
    q.add(first, { ...entry('a', 1000), rating: 4 })
    await q.flush()
    // Versehentlich „Nochmal“ – ersetzt den ungesendeten Stand in der Warteschlange
    const wrong: CardReview = { cardId: 'a', side: 0, ...schedule(previous, 1, 61_000) }
    q.add(wrong, entry('a', 61_000))
    expect(stored().pending).toEqual([wrong])
    q.undo({ cardId: 'a', side: 0, reviewedAt: 61_000, previous })
    expect(stored().pending).toEqual([first])
    expect(storedAll().log?.map((e) => e.reviewedAt)).toEqual([1000])
    expect(q.getSnapshot()).toEqual([first])

    const fetchMock = vi.fn().mockResolvedValue(ok())
    vi.stubGlobal('fetch', fetchMock)
    await q.flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.reviews).toEqual([first])
    expect(body.log.map((e: { reviewedAt: number }) => e.reviewedAt)).toEqual([1000])
    expect(body.undo).toEqual([{ cardId: 'a', side: 0, reviewedAt: 61_000, previous }])
  })

  it('nach dem Senden, offline: Die Rücknahme wird nachgereicht und überlagert bis dahin die Serverdaten', async () => {
    const q = started()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()))
    const r = review('a', 1000)
    q.add(r, entry('a', 1000))
    await q.flush()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    // Neue Karte: Danach ist sie wieder neu
    const undo = { cardId: 'a', side: 0, reviewedAt: 1000, previous: null }
    q.undo(undo)
    await q.flush()
    expect(q.getSnapshot()).toEqual([])
    expect(applyUndos([r], q.getUndoSnapshot())).toEqual([])
    // Auch nach einem Neuladen der Seite
    expect(storedAll().undo).toEqual([undo])
    const reloaded = new ReviewQueue()
    reloaded.start(1, qc)
    expect(reloaded.getUndoSnapshot()).toEqual([undo])

    const fetchMock = vi.fn().mockResolvedValue(ok())
    vi.stubGlobal('fetch', fetchMock)
    await q.flush()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).undo).toEqual([undo])
    expect(storedAll().undo).toEqual([])
    // Daten aus dem Offline-Cache mit der alten Bewertung: Die Überlagerung bleibt, bis der Server sie nicht mehr führt
    q.prune(data([r]))
    expect(applyUndos([r], q.getUndoSnapshot())).toEqual([])
    q.prune(data([]))
    expect(q.getUndoSnapshot()).toEqual([])
    expect(store.has(KEY)).toBe(false)
  })

  it('lässt einen inzwischen neueren Stand stehen und reicht mehrfaches Rückgängig bis zum Anfang', () => {
    const s0 = schedule(null, 3, 1000)
    const s1 = schedule(s0, 3, 2000)
    const s2 = schedule(s1, 1, 3000)
    const undos = [
      { cardId: 'a', side: 0, reviewedAt: 2000, previous: s0 },
      { cardId: 'a', side: 0, reviewedAt: 3000, previous: s1 },
    ]
    expect(applyUndos([{ cardId: 'a', side: 0, ...s2 }], undos)).toEqual([{ cardId: 'a', side: 0, ...s0 }])
    // Ein anderes Gerät hat später weitergelernt
    const later: CardReview = { cardId: 'a', side: 0, ...schedule(s2, 3, 4000) }
    expect(applyUndos([later], undos)).toEqual([later])
  })

  it('holt zurückgenommene Bewertungen nicht aus dem Speicher eines anderen Tabs zurück', () => {
    const q = started()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    q.add(review('a', 1000), entry('a', 1000))
    const old = store.get(KEY)!
    q.undo({ cardId: 'a', side: 0, reviewedAt: 1000, previous: null })
    // Ein anderer Tab schreibt seinen älteren Stand zurück
    store.set(KEY, old)
    q.add(review('b', 2000))
    expect(stored().pending.map((r) => r.cardId)).toEqual(['b'])
    expect(storedAll().log).toEqual([])
    // Ein Tab, der die Bewertung schon geladen hat, übernimmt die Rücknahme aus dem Speicher
    store.set(KEY, old)
    const other = new ReviewQueue()
    other.start(1, qc)
    expect(other.getSnapshot().map((r) => r.cardId)).toEqual(['a'])
    q.add(review('c', 3000))
    other.add(review('d', 4000))
    expect(other.getSnapshot().map((r) => r.cardId).sort()).toEqual(['b', 'c', 'd'])
  })
})
