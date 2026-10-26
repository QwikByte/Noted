import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Browser-Umgebung für die Entwürfe nachbilden – mit einem lokalen Speicher, der voll sein kann
const store = new Map<string, string>()
let full = false
let writes = 0
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    writes++
    if (full) throw new DOMException('Speicher voll', 'QuotaExceededError')
    store.set(k, v)
  },
  removeItem: (k: string) => void store.delete(k),
})
const unloadListeners = new Set<unknown>()
// Je Ereignis der zuletzt angemeldete Empfänger – der des Entwurfsspeichers dieses Tests
const pageListeners = new Map<string, () => void>()
vi.stubGlobal('window', {
  addEventListener: (type: string, fn: () => void) => {
    if (type === 'beforeunload') unloadListeners.add(fn)
    else pageListeners.set(type, fn)
  },
  removeEventListener: (type: string, fn: unknown) => type === 'beforeunload' && unloadListeners.delete(fn),
})
let visibilityState = 'visible'
vi.stubGlobal('document', {
  addEventListener: (type: string, fn: () => void) => pageListeners.set(type, fn),
  get visibilityState() {
    return visibilityState
  },
})

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
  writes = 0
  visibilityState = 'visible'
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
    // Der lokale Speicher wird gebündelt geschrieben – hier sofort
    sync.persistNow()
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

  it('schreibt den lokalen Speicher beim Tippen gebündelt – beim Verstecken des Tabs und vor dem Schließen sofort', () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
      const stored = () => (JSON.parse(store.get('noted:drafts:1') ?? '[]') as { content: string }[])[0]?.content
      // Zehn schnelle Änderungen: geschrieben wird erst nach einer halben Sekunde Ruhe, einmal
      for (let i = 1; i <= 10; i++) {
        sync.update('n1', 1, { content: `Satz ${i}` })
        vi.advanceTimersByTime(50)
      }
      expect(writes).toBe(0)
      vi.advanceTimersByTime(500)
      expect(writes).toBe(1)
      expect(stored()).toBe('Satz 10')

      // Ohne Pause: spätestens alle zwei Sekunden
      for (let i = 1; i <= 25; i++) {
        sync.update('n1', 1, { content: `Absatz ${i}` })
        vi.advanceTimersByTime(100)
      }
      expect(writes).toBe(2)

      sync.update('n1', 1, { content: 'Zuletzt getippt' })
      visibilityState = 'hidden'
      pageListeners.get('visibilitychange')!()
      expect(writes).toBe(3)
      expect(stored()).toBe('Zuletzt getippt')

      sync.update('n1', 1, { content: 'Noch schnell' })
      pageListeners.get('pagehide')!()
      expect(writes).toBe(4)
      expect(stored()).toBe('Noch schnell')
      // Nichts mehr ausstehend: kein weiteres Schreiben
      vi.advanceTimersByTime(3_000)
      pageListeners.get('pagehide')!()
      expect(writes).toBe(4)
    } finally {
      vi.useRealTimers()
    }
  })

  it('schreibt vor dem Senden, was gesendet wird', async () => {
    const pending = vi.fn(() => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', pending)
    sync.update('n1', 1, { content: 'Gleich gesendet' })
    expect(writes).toBe(0)
    void sync.flush('n1')
    expect(writes).toBe(1)
    expect(pending).toHaveBeenCalledTimes(1)
  })

  it('reine Statuswechsel lassen die Liste der Entwürfe unverändert', async () => {
    let answer: (r: Response) => void = () => {}
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))))
    const listener = vi.fn()
    sync.subscribe(listener)
    sync.update('n1', 1, { content: 'Text' })
    const drafts = sync.getDrafts()
    expect(drafts).toHaveLength(1)

    void sync.flush('n1')
    // Speichert …: Status neu, Entwürfe dieselben
    expect(sync.getStatus('n1').state).toBe('saving')
    expect(sync.getDrafts()).toBe(drafts)
    expect(listener).toHaveBeenCalledTimes(2)

    // Weitergeschrieben während des Speicherns: neue Liste
    sync.update('n1', 1, { content: 'Text, länger' })
    const typed = sync.getDrafts()
    expect(typed).not.toBe(drafts)
    answer(saved('n1'))
    await settle()
    // Gespeichert, aber noch nicht der letzte Stand – der Entwurf ist ersetzt (neue Basisversion), nicht verändert
    expect(sync.getStatus('n1').state).toBe('pending')
    expect(sync.getDrafts()).not.toBe(typed)
    expect(typed[0].baseVersion).toBe(1)
    expect(sync.getDrafts()[0]).toMatchObject({ baseVersion: 2, content: 'Text, länger' })
  })
})
