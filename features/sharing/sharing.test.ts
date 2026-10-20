import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ADMIN_PASSWORD, call, loginAs, setupTestEnv } from '@/tests/helpers'
import * as notes from '@/app/api/notes/route'
import * as note from '@/app/api/notes/[id]/route'
import * as restore from '@/app/api/notes/[id]/restore/route'
import * as noteShares from '@/app/api/notes/[id]/shares/route'
import * as shares from '@/app/api/shares/route'
import * as share from '@/app/api/shares/[id]/route'
import * as shared from '@/app/api/s/[token]/route'
import * as sharedFile from '@/app/api/s/[token]/files/[...name]/route'
import * as attachments from '@/app/api/attachments/route'
import * as users from '@/app/api/admin/users/route'
import * as password from '@/app/api/account/password/route'
import { getDb } from '@/shared/server/db'
import { clearAllRateLimits } from '@/shared/server/rate-limit'
import { getSharedNote, purgeExpiredShares } from './server/shares'
import type { Share } from './types'

let env: Awaited<ReturnType<typeof setupTestEnv>>
let token = ''
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7])
const DAY = 86_400_000

beforeAll(async () => {
  env = await setupTestEnv()
  token = await loginAs('admin', ADMIN_PASSWORD)
  for (const [name, data] of [
    ['Tafel.png', png],
    ['Geheim.png', new Uint8Array([1, 2, 3])],
  ] as const) {
    const form = new FormData()
    form.append('file', new File([data], name))
    expect((await call(attachments.POST, '/', { cookie: token, form })).status).toBe(201)
  }
})
afterAll(() => env.cleanup())
beforeEach(() => clearAllRateLimits())

async function newNote(title: string, content: string, format = 'markdown') {
  const r = await call(notes.POST, '/api/notes', { cookie: token, body: { title, content, folderId: null, format } })
  expect(r.status).toBe(201)
  return r.data.note as { id: string }
}

async function createShare(noteId: string, expiresInDays: 7 | 30 | null = 30, cookie = token) {
  return call(noteShares.POST, '/', { cookie, params: { id: noteId }, body: { expiresInDays } })
}

const tokenOf = (url: string) => url.split('/s/')[1]
const open = (t: string, ip = '198.51.100.1') =>
  call(shared.GET, `/api/s/${t}`, { params: { token: t }, headers: { 'x-forwarded-for': ip } })
const file = (t: string, name: string) => call(sharedFile.GET, '/', { params: { token: t, name: name.split('/') } })

describe('Notizen per Link teilen', () => {
  it('liefert die Notiz ohne Anmeldung und zählt die Aufrufe', async () => {
    const n = await newNote('Thermodynamik', '# Hauptsatz\n\n![[Tafel.png]] und [[Andere Notiz]]')
    const r = await createShare(n.id, 7)
    expect(r.status).toBe(201)
    expect(r.data.url).toMatch(/^http:\/\/localhost:3000\/s\/[A-Za-z0-9_-]{43}$/)
    const s = r.data.share as Share
    expect(s).toMatchObject({ noteId: n.id, noteTitle: 'Thermodynamik', opens: 0, noteTrashed: false })
    expect(s.expiresAt! - s.createdAt).toBe(7 * DAY)
    // Gespeichert ist nur der Hash – das Token steht nirgends in der Datenbank
    expect(JSON.stringify(getDb().prepare('SELECT * FROM shares').all())).not.toContain(tokenOf(r.data.url))

    const guest = await open(tokenOf(r.data.url))
    expect(guest.status).toBe(200)
    expect(guest.data).toEqual({
      title: 'Thermodynamik',
      format: 'markdown',
      content: '# Hauptsatz\n\n![[Tafel.png]] und [[Andere Notiz]]',
      updatedAt: expect.any(Number),
    })
    const list = await call(noteShares.GET, '/', { cookie: token, params: { id: n.id } })
    expect(list.data.shares).toMatchObject([{ id: s.id, opens: 1, lastOpenedAt: expect.any(Number) }])
  })

  it('liefert nur Dateien, die die Notiz selbst verwendet', async () => {
    const n = await newNote('Mit Bild', 'Siehe ![[Tafel.png|300]]')
    const t = tokenOf((await createShare(n.id)).data.url)
    const img = await file(t, 'Tafel.png')
    expect(img.status).toBe(200)
    expect(img.res.headers.get('content-security-policy')).toContain('sandbox')
    expect(img.res.headers.get('cache-control')).toBe('private, no-store')
    expect(new Uint8Array(await img.res.arrayBuffer())).toEqual(png)
    expect((await file(t, 'Ordner/tafel.png')).status).toBe(200)
    // Andere Datei desselben Kontos und nicht vorhandene Dateien
    expect((await file(t, 'Geheim.png')).status).toBe(404)
    expect((await file(t, 'Fehlt.png')).status).toBe(404)
  })

  it('liefert für falsche, widerrufene und abgelaufene Links dasselbe 404', async () => {
    const n = await newNote('Kurzlebig', 'Inhalt')
    const r = await createShare(n.id, 7)
    const t = tokenOf(r.data.url)
    const wrong = await open('A'.repeat(43))
    const malformed = await open('kurz')
    expect(wrong.status).toBe(404)
    expect(malformed.status).toBe(404)
    expect(malformed.data).toEqual(wrong.data)

    // Abgelaufen: nach acht Tagen nicht mehr abrufbar, beim Aufräumen gelöscht
    expect(() => getSharedNote(t, null, Date.now() + 8 * DAY)).toThrow(expect.objectContaining({ status: 404 }))
    expect(getSharedNote(t, null, Date.now() + 6 * DAY).title).toBe('Kurzlebig')
    purgeExpiredShares(Date.now() + 8 * DAY)
    expect((await open(t)).status).toBe(404)

    const r2 = await createShare(n.id, null)
    expect(r2.data.share.expiresAt).toBeNull()
    const del = await call(share.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: r2.data.share.id } })
    expect(del.status).toBe(200)
    const revoked = await open(tokenOf(r2.data.url))
    expect(revoked.status).toBe(404)
    expect(revoked.data).toEqual(wrong.data)
    const events = getDb().prepare("SELECT event FROM audit_log WHERE event LIKE 'share_%' ORDER BY id").all()
    expect(events.map((e) => (e as { event: string }).event)).toEqual(expect.arrayContaining(['share_created', 'share_revoked']))
  })

  it('schaltet den Link im Papierkorb ab und löscht ihn mit der Notiz', async () => {
    const n = await newNote('Zwischendurch weg', 'Inhalt')
    const r = await createShare(n.id)
    const t = tokenOf(r.data.url)
    await call(note.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: n.id } })
    expect((await open(t)).status).toBe(404)
    const all = await call(shares.GET, '/', { cookie: token })
    expect((all.data.shares as Share[]).find((s) => s.noteId === n.id)?.noteTrashed).toBe(true)
    await call(restore.POST, '/', { cookie: token, params: { id: n.id } })
    expect((await open(t)).status).toBe(200)
    await call(note.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: n.id }, query: { permanent: '1' } })
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM shares WHERE note_id = ?').get(n.id)).toEqual({ n: 0 })
  })

  it('teilt kein Canvas und bremst viele Aufrufe von einer Adresse', async () => {
    const canvas = await newNote('Fläche', JSON.stringify({ nodes: [], edges: [] }), 'canvas')
    expect((await createShare(canvas.id)).status).toBe(400)

    const n = await newNote('Beliebt', 'Inhalt')
    const t = tokenOf((await createShare(n.id)).data.url)
    for (let i = 0; i < 60; i++) expect((await open(t, '203.0.113.9')).status).toBe(200)
    const limited = await open(t, '203.0.113.9')
    expect(limited.status).toBe(429)
    expect((await open(t, '203.0.113.10')).status).toBe(200)
  })

  it('zeigt und widerruft fremde Links nicht', async () => {
    const n = await newNote('Nur meins', 'Inhalt')
    const r = await createShare(n.id)
    await call(users.POST, '/api/admin/users', { cookie: token, body: { username: 'teilgast', password: 'Teil-Kennwort-1' } })
    const other = await loginAs('teilgast', 'Teil-Kennwort-1')
    await call(password.POST, '/', { cookie: other, body: { currentPassword: 'Teil-Kennwort-1', newPassword: 'Teil-Kennwort-2' } })
    expect((await call(shares.GET, '/', { cookie: other })).data.shares).toEqual([])
    expect((await call(noteShares.GET, '/', { cookie: other, params: { id: n.id } })).status).toBe(404)
    expect((await createShare(n.id, 30, other)).status).toBe(404)
    expect((await call(share.DELETE, '/', { method: 'DELETE', cookie: other, params: { id: r.data.share.id } })).status).toBe(404)
    expect((await open(tokenOf(r.data.url))).status).toBe(200)
    expect((await call(noteShares.GET, '/', { params: { id: n.id } })).status).toBe(401)
  })

  it('verwendet APP_URL für den Link und ist mit SHARING=false komplett abgeschaltet', async () => {
    const n = await newNote('Abschaltbar', '![[Tafel.png]]')
    process.env.APP_URL = 'https://notizen.example.com/'
    let url: string
    try {
      url = (await createShare(n.id)).data.url
      expect(url).toMatch(/^https:\/\/notizen\.example\.com\/s\//)
    } finally {
      delete process.env.APP_URL
    }
    const id = (await call(noteShares.GET, '/', { cookie: token, params: { id: n.id } })).data.shares[0].id
    process.env.SHARING = 'false'
    try {
      expect((await open(tokenOf(url))).status).toBe(404)
      expect((await file(tokenOf(url), 'Tafel.png')).status).toBe(404)
      expect((await createShare(n.id)).status).toBe(404)
      expect((await call(noteShares.GET, '/', { cookie: token, params: { id: n.id } })).status).toBe(404)
      expect((await call(shares.GET, '/', { cookie: token })).status).toBe(404)
      expect((await call(share.DELETE, '/', { method: 'DELETE', cookie: token, params: { id } })).status).toBe(404)
    } finally {
      delete process.env.SHARING
    }
    expect((await open(tokenOf(url))).status).toBe(200)
  })
})
