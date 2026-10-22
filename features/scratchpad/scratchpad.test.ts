import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import type { QueryClient } from '@tanstack/react-query'
import { ADMIN_PASSWORD, call, loginAs, setupTestEnv } from '@/tests/helpers'
import * as route from '@/app/api/scratchpad/route'
import * as notes from '@/app/api/notes/route'
import * as search from '@/app/api/search/route'
import * as tags from '@/app/api/tags/route'
import * as exportRoute from '@/app/api/export/route'
import * as users from '@/app/api/admin/users/route'
import * as userRoute from '@/app/api/admin/users/[id]/route'
import * as password from '@/app/api/account/password/route'
import { MAX_SCRATCHPAD_LENGTH } from './limits'
import type { Scratchpad } from './types'

let env: Awaited<ReturnType<typeof setupTestEnv>>
let token = ''

beforeAll(async () => {
  env = await setupTestEnv()
  token = await loginAs('admin', ADMIN_PASSWORD)
})
afterAll(() => env.cleanup())

const get = (cookie: string | null = token) => call(route.GET, '/api/scratchpad', { cookie })
const put = (content: string, baseVersion: number, cookie: string | null = token, csrf = true) =>
  call(route.PUT, '/api/scratchpad', { method: 'PUT', cookie, body: { content, baseVersion }, csrf })

describe('Schmierzettel auf dem Server', () => {
  it('ist anfangs leer und zählt jede Änderung hoch', async () => {
    expect((await get()).data).toEqual({ scratchpad: { content: '', version: 0, updatedAt: null } })
    const first = await put('Raum 3.14 statt 2.01', 0)
    expect(first.status).toBe(200)
    expect(first.data.scratchpad).toMatchObject({ content: 'Raum 3.14 statt 2.01', version: 1 })
    expect(first.data.scratchpad.updatedAt).toBeGreaterThan(0)
    // Wiederholtes Senden desselben Stands ändert nichts
    expect((await put('Raum 3.14 statt 2.01', 1)).data.scratchpad).toEqual(first.data.scratchpad)
    expect((await get()).data.scratchpad).toEqual(first.data.scratchpad)
  })

  it('meldet einen Konflikt mit dem Serverstand, wenn ein anderes Gerät schneller war', async () => {
    const r = await put('Veralteter Stand', 0)
    expect(r.status).toBe(409)
    expect(r.data.error).toBe('version_conflict')
    expect(r.data.scratchpad).toMatchObject({ content: 'Raum 3.14 statt 2.01', version: 1 })
    expect((await get()).data.scratchpad.content).toBe('Raum 3.14 statt 2.01')
  })

  it('nimmt höchstens 20 000 Zeichen', async () => {
    const full = await put('x'.repeat(MAX_SCRATCHPAD_LENGTH), 1)
    expect(full.status).toBe(200)
    const tooLong = await put('x'.repeat(MAX_SCRATCHPAD_LENGTH + 1), full.data.scratchpad.version)
    expect(tooLong.status).toBe(400)
    expect(tooLong.data.message).toBe('Der Schmierzettel ist zu lang (höchstens 20 000 Zeichen).')
    expect((await put('', full.data.scratchpad.version)).status).toBe(200)
  })

  it('braucht eine Anmeldung und den CSRF-Header', async () => {
    expect((await get(null)).status).toBe(401)
    expect((await put('x', 0, null)).status).toBe(401)
    const version = (await get()).data.scratchpad.version
    expect((await put('ohne Header', version, token, false)).status).toBe(403)
  })
})

describe('Schmierzettel: getrennt je Konto und keine Notiz', () => {
  let other = ''
  let otherId = 0

  beforeAll(async () => {
    const created = await call(users.POST, '/api/admin/users', {
      cookie: token,
      body: { username: 'zettel', password: 'Geheim-Wort-Eins-1' },
    })
    expect(created.status, JSON.stringify(created.data)).toBe(201)
    otherId = created.data.user.id
    const first = await loginAs('zettel', 'Geheim-Wort-Eins-1')
    await call(password.POST, '/', {
      cookie: first,
      body: { currentPassword: 'Geheim-Wort-Eins-1', newPassword: 'Geheim-Wort-Zwei-2' },
    })
    other = await loginAs('zettel', 'Geheim-Wort-Zwei-2')
  })

  it('zeigt einem anderen Konto nichts und lässt es nichts ändern', async () => {
    const mine = (await get()).data.scratchpad as Scratchpad
    await put('Geheimer Zettel', mine.version)
    expect((await get(other)).data.scratchpad).toEqual({ content: '', version: 0, updatedAt: null })
    expect((await put('Fremd', 0, other)).status).toBe(200)
    expect((await get()).data.scratchpad.content).toBe('Geheimer Zettel')
    expect((await get(other)).data.scratchpad.content).toBe('Fremd')
  })

  it('taucht weder in Suche, Tags, Notizen, Benutzerverwaltung noch im Export auf', async () => {
    const notesBefore = (await call(notes.GET, '/', { cookie: token })).data.notes
    const usersBefore = (await call(users.GET, '/', { cookie: token })).data.users
    await put('Quokka #zettelgeheim [[Analysis]]', (await get()).data.scratchpad.version)

    expect((await call(search.GET, '/', { cookie: token, query: { q: 'Quokka' } })).data.results).toEqual([])
    const tagList = (await call(tags.GET, '/', { cookie: token })).data.tags as { tag: string }[]
    expect(tagList.map((t) => t.tag)).not.toContain('zettelgeheim')
    expect((await call(notes.GET, '/', { cookie: token })).data.notes).toEqual(notesBefore)
    expect((await call(users.GET, '/', { cookie: token })).data.users).toEqual(usersBefore)

    const r = await call(exportRoute.GET, '/', { cookie: token })
    const zip = unzipSync(new Uint8Array(await r.res.arrayBuffer()))
    for (const [name, data] of Object.entries(zip)) expect(strFromU8(data), name).not.toContain('Quokka')
  })

  it('wird mit dem Konto gelöscht', async () => {
    const { getDb } = await import('@/shared/server/db')
    const count = () =>
      (getDb().prepare('SELECT COUNT(*) AS n FROM scratchpads WHERE user_id = ?').get(otherId) as { n: number }).n
    expect(count()).toBe(1)
    const r = await call(userRoute.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: String(otherId) } })
    expect(r.status).toBe(200)
    expect(count()).toBe(0)
  })
})

describe('Schmierzettel im Browser', () => {
  const store = new Map<string, string>()
  const KEY = 'noted:scratchpad:7'
  const T = Date.parse('2026-10-22T10:00:00Z')
  const respond = (status: number, body: object) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const saved = (content: string, version: number) => respond(200, { scratchpad: { content, version, updatedAt: T } })
  const sent = (fetchMock: ReturnType<typeof vi.fn>, call: number) => JSON.parse(fetchMock.mock.calls[call][1].body as string)

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
    vi.stubGlobal('window', { addEventListener: () => {} })
    vi.stubGlobal('document', { addEventListener: () => {}, visibilityState: 'visible' })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function startedStore() {
    const { scratchpad } = await import('./client/scratchpad')
    scratchpad.start(7, { setQueryData: () => undefined } as unknown as QueryClient)
    return scratchpad
  }

  it('hält den Text offline im localStorage und sendet ihn beim nächsten Versuch', async () => {
    const scratchpad = await startedStore()
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(saved('Raum 3.14', 1))
    vi.stubGlobal('fetch', fetchMock)
    scratchpad.set('Raum 3.14')
    await scratchpad.flush()
    expect(scratchpad.getSnapshot()).toMatchObject({ content: 'Raum 3.14', dirty: true, status: 'offline' })
    expect(JSON.parse(store.get(KEY)!)).toMatchObject({ content: 'Raum 3.14', dirty: true, version: 0 })
    expect(scratchpad.hasPending()).toBe(true)

    await scratchpad.flush()
    expect(sent(fetchMock, 1)).toEqual({ content: 'Raum 3.14', baseVersion: 0 })
    expect(scratchpad.getSnapshot()).toMatchObject({ content: 'Raum 3.14', version: 1, base: 'Raum 3.14', dirty: false })
    expect(scratchpad.getSnapshot().status).toBe('saved')
    expect(scratchpad.hasPending()).toBe(false)
  })

  it('führt bei einem Konflikt zusammen und sendet auf dem neuen Stand', async () => {
    const scratchpad = await startedStore()
    const theirs = { content: 'Raum 3.14\nTel. 0123 456', version: 2, updatedAt: T }
    const merged = 'Raum 3.14\nTel. 0123 456\n\nMilch'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond(409, { error: 'version_conflict', message: 'Geändert.', scratchpad: theirs }))
      .mockResolvedValueOnce(saved(merged, 3))
    vi.stubGlobal('fetch', fetchMock)
    scratchpad.set('Raum 3.14\nMilch')
    await scratchpad.flush()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sent(fetchMock, 1)).toEqual({ content: merged, baseVersion: 2 })
    expect(scratchpad.getSnapshot()).toMatchObject({ content: merged, version: 3, dirty: false, merged: true })
    // Weiterschreiben blendet den Hinweis wieder aus
    scratchpad.set(merged + '!')
    expect(scratchpad.getSnapshot().merged).toBe(false)
  })

  it('übernimmt den Serverstand nur, wenn er neuer ist und nichts ungesendet ist', async () => {
    const scratchpad = await startedStore()
    const version = scratchpad.getSnapshot().version
    scratchpad.receive({ content: 'Vom Handy', version: version + 5, updatedAt: T })
    expect(scratchpad.getSnapshot().content).toBe('Raum 3.14\nTel. 0123 456\n\nMilch!')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(saved('Raum 3.14\nTel. 0123 456\n\nMilch!', version + 1)))
    await scratchpad.flush()
    scratchpad.receive({ content: 'Älter', version: version + 1, updatedAt: T })
    expect(scratchpad.getSnapshot().content).toBe('Raum 3.14\nTel. 0123 456\n\nMilch!')
    scratchpad.receive({ content: 'Vom Handy', version: version + 2, updatedAt: T })
    expect(scratchpad.getSnapshot()).toMatchObject({ content: 'Vom Handy', version: version + 2, dirty: false })
  })

  it('sendet zu lange Texte gar nicht erst', async () => {
    const scratchpad = await startedStore()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    scratchpad.set('x'.repeat(MAX_SCRATCHPAD_LENGTH + 1))
    await scratchpad.flush()
    await scratchpad.flush()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(scratchpad.getSnapshot()).toMatchObject({ status: 'error', dirty: true })
  })

  it('löscht beim Abmelden den Speicher des Kontos', async () => {
    const scratchpad = await startedStore()
    expect(store.has(KEY)).toBe(true)
    scratchpad.clearAll()
    expect(store.has(KEY)).toBe(false)
    expect(scratchpad.getSnapshot()).toMatchObject({ content: '', version: 0, dirty: false })
  })
})
