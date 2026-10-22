import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Browser-Umgebung für die Entwürfe nachbilden – mit einem lokalen Speicher, der voll sein kann
const store = new Map<string, string>()
let full = false
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    if (full) throw new DOMException('Speicher voll', 'QuotaExceededError')
    store.set(k, v)
  },
  removeItem: (k: string) => void store.delete(k),
})
const unloadListeners = new Set<unknown>()
vi.stubGlobal('window', {
  addEventListener: (type: string, fn: unknown) => type === 'beforeunload' && unloadListeners.add(fn),
  removeEventListener: (type: string, fn: unknown) => type === 'beforeunload' && unloadListeners.delete(fn),
})
vi.stubGlobal('document', { addEventListener: () => {} })

const { SyncStore } = await import('./client/sync')

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const saved = (id: string) => json(200, { note: { id, title: id, version: 2 }, linksUpdated: 0 })
/** Bis die angestoßenen Sendeversuche durch sind */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

let sync: InstanceType<typeof SyncStore>
beforeEach(() => {
  store.clear()
  unloadListeners.clear()
  full = false
  sync = new SyncStore()
  sync.start(1)
})
afterEach(() => {
  sync.clearAll()
})

describe('Entwürfe im Browser', () => {
  it('sendet bei vollem lokalem Speicher alle Entwürfe nach – nicht nur den der offenen Notiz', async () => {
    full = true
    const offline = vi.fn().mockRejectedValue(new TypeError('offline'))
    vi.stubGlobal('fetch', offline)
    sync.update('n1', 1, { content: 'Vorlesung 4' })
    sync.update('n2', 1, { content: 'Vorlesung 5' })
    expect(sync.isMemoryOnly()).toBe(true)
    // Vor dem Schließen des Tabs warnen, solange nichts gesichert ist
    expect(unloadListeners.size).toBe(1)

    sync.flushAll()
    await settle()
    expect(offline).toHaveBeenCalledTimes(2)
    expect(sync.getStatus('n1').state).toBe('offline')

    // Wieder online: Beide kommen an, ohne die Notizen zu öffnen
    const online = vi.fn((url: string) => Promise.resolve(saved(url.split('/').pop()!)))
    vi.stubGlobal('fetch', online)
    sync.flushAll()
    await settle()
    expect(online.mock.calls.map(([url]) => url).sort()).toEqual(['/api/notes/n1', '/api/notes/n2'])
    expect(sync.hasPending()).toBe(false)
    // Ohne Entwürfe klappt das Schreiben wieder
    expect(sync.isMemoryOnly()).toBe(false)
    expect(unloadListeners.size).toBe(0)
  })

  it('wiederholt vom Server abgelehnte Entwürfe nicht automatisch', async () => {
    const rejected = vi.fn().mockResolvedValue(json(400, { error: 'too_large', message: 'Die Notiz ist zu groß.' }))
    vi.stubGlobal('fetch', rejected)
    sync.update('n1', 1, { content: 'x' })
    sync.flushAll()
    await settle()
    expect(sync.getStatus('n1')).toMatchObject({ state: 'error', error: 'Die Notiz ist zu groß.' })
    sync.flushAll()
    await settle()
    expect(rejected).toHaveBeenCalledTimes(1)
  })
})
