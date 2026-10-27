import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueryClient } from '@tanstack/react-query'
import type { PdfAnnotation } from './types'

// Browser-Umgebung für die Warteschlange nachbilden (localStorage, Ereignisse)
const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
})
vi.stubGlobal('window', { addEventListener: () => {} })
vi.stubGlobal('document', { addEventListener: () => {} })

const { AnnotationStore } = await import('./client/annotations')

const qc = { setQueryData: () => {} } as unknown as QueryClient
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const input: Omit<PdfAnnotation, 'id' | 'createdAt' | 'updatedAt'> = {
  attachmentId: 'a1',
  kind: 'text',
  page: 1,
  rects: [[0, 0, 10, 10]],
  quote: 'Zitat',
  comment: '',
  color: 1,
}

/** Bis der Sendeversuch nach `create()` durch ist */
async function attempted(fetchMock: ReturnType<typeof vi.fn>) {
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function started() {
  const s = new AnnotationStore()
  s.start(1, qc)
  return s
}

beforeEach(() => {
  store.clear()
})

describe('Warteschlange für PDF-Anmerkungen', () => {
  it('meldet ungesendete Markierungen, bis sie beim Server angekommen sind', async () => {
    const s = started()
    expect(s.hasPending()).toBe(false)
    const offline = vi.fn().mockRejectedValue(new TypeError('offline'))
    vi.stubGlobal('fetch', offline)
    s.create(input)
    await attempted(offline)
    expect(s.hasPending()).toBe(true)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { annotations: [] })))
    await s.flush()
    expect(s.hasPending()).toBe(false)
  })

  it('bleibt bei einem Serverfehler ausstehend, nach dem Leeren nicht mehr', async () => {
    const s = started()
    const failing = vi.fn().mockResolvedValue(json(500, { error: 'server', message: 'Fehler' }))
    vi.stubGlobal('fetch', failing)
    s.create(input)
    await attempted(failing)
    expect(s.hasPending()).toBe(true)
    s.clearAll()
    expect(s.hasPending()).toBe(false)
  })

  it('zählt auch Löschungen und Änderungen aus anderen Tabs', () => {
    const s = started()
    store.set('noted:pdf:annotations:1', JSON.stringify({ upserts: [], deletes: [{ id: 'x', attachmentId: 'a1' }] }))
    expect(s.hasPending()).toBe(true)
  })
})
