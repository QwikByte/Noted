import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ADMIN_PASSWORD, call, loginAs, setupTestEnv } from '@/tests/helpers'
import { makePdf } from '@/tests/pdf'
import * as attachments from '@/app/api/attachments/route'
import * as attachment from '@/app/api/attachments/[id]/route'
import * as reindex from '@/app/api/attachments/[id]/index/route'
import * as searchRoute from '@/app/api/search/route'
import * as notes from '@/app/api/notes/route'
import * as users from '@/app/api/admin/users/route'
import * as user from '@/app/api/admin/users/[id]/route'
import * as password from '@/app/api/account/password/route'
import { getDb } from '@/shared/server/db'
import { indexMissing, indexPending } from './server/index'
import type { FileEntry } from './types'
import type { SearchResponse } from '@/features/notes/types'

let env: Awaited<ReturnType<typeof setupTestEnv>>
let token = ''

beforeAll(async () => {
  env = await setupTestEnv()
  token = await loginAs('admin', ADMIN_PASSWORD)
})
afterAll(() => env.cleanup())

async function upload(name: string, data: Uint8Array, cookie = token) {
  const form = new FormData()
  form.append('file', new File([new Uint8Array(data)], name))
  const r = await call(attachments.POST, '/', { cookie, form })
  expect(r.status).toBe(201)
  return r.data.attachment as { id: string; filename: string }
}

async function search(q: string, cookie = token): Promise<SearchResponse> {
  const r = await call(searchRoute.GET, '/', { cookie, query: { q } })
  expect(r.status).toBe(200)
  return r.data as SearchResponse
}

async function searchState(id: string) {
  const r = await call(attachments.GET, '/', { cookie: token, query: { notes: '1' } })
  return (r.data.attachments as FileEntry[]).find((a) => a.id === id)?.search
}

const ftsRows = (id: string) =>
  (getDb().prepare('SELECT COUNT(*) AS n FROM attachments_fts WHERE attachment_id = ?').get(id) as { n: number }).n

describe('Volltextsuche in Dateien', () => {
  it('findet Text im PDF samt Seitenzahl – nach dem Upload im Hintergrund gelesen', async () => {
    const pdf = await upload('Skript Thermo.pdf', makePdf([['Einleitung'], ['Hauptsätze'], ['Entropie', 'Wärmekraftmaschine']]))
    await indexPending()
    const r = await search('wärmekraft')
    expect(r.results).toEqual([])
    expect(r.files).toEqual([
      { id: pdf.id, filename: 'Skript Thermo.pdf', mime: 'application/pdf', page: 3, snippet: expect.stringContaining('\u0002') },
    ])
    // Umlaute und Groß-/Kleinschreibung egal, #tag-Filter gelten nur für Notizen
    expect((await search('WARMEKRAFT')).files).toHaveLength(1)
    expect((await search('#physik entropie')).files.map((f) => f.page)).toEqual([3])
    expect(await searchState(pdf.id)).toEqual({ state: 'done', pages: 3, reason: null })
    // Phrasen und Ausschlüsse gelten auch in Dateien
    expect((await search('"Entropie Wärmekraft"')).files.map((f) => f.page)).toEqual([3])
    expect((await search('"Wärmekraftmaschine Entropie"')).files).toEqual([])
    expect((await search('entropie -wärmekraft')).files).toEqual([])
  })

  it('durchsucht Text-, Markdown- und CSV-Dateien als Seite 1, Bilder gar nicht', async () => {
    const txt = await upload('Notizen.txt', new TextEncoder().encode('Vorlesung über Quantenzahlen'))
    const md = await upload('Zusammenfassung.md', new TextEncoder().encode('# Quantenmechanik\n\nKurz gefasst'))
    const csv = await upload('Messwerte.csv', new TextEncoder().encode('Messung;Quantenausbeute\n1;0,5'))
    const png = await upload('Foto.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    await indexPending()
    const r = await search('quanten')
    expect(r.files.map((f) => [f.filename, f.page]).sort()).toEqual([
      ['Messwerte.csv', 1],
      ['Notizen.txt', 1],
      ['Zusammenfassung.md', 1],
    ])
    expect(r.files.find((f) => f.id === md.id)?.mime).toBe('text/markdown')
    expect(await searchState(txt.id)).toMatchObject({ state: 'done' })
    expect(await searchState(csv.id)).toMatchObject({ state: 'done' })
    expect(await searchState(png.id)).toBeUndefined()
  })

  it('meldet Scans ohne Text und kaputte PDFs als nicht durchsuchbar – der Upload klappt trotzdem', async () => {
    const scan = await upload('Scan.pdf', makePdf([[], []]))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = await upload('Kaputt.pdf', new TextEncoder().encode('%PDF-1.4 kaputt'))
    await indexPending()
    log.mockRestore()
    expect(await searchState(scan.id)).toEqual({ state: 'skipped', pages: 0, reason: 'kein Text gefunden' })
    expect(await searchState(broken.id)).toEqual({ state: 'skipped', pages: 0, reason: 'nicht lesbar' })
  })

  it('liest von einem PDF mit 1 000 Seiten nur die ersten 400', async () => {
    const pdf = await upload('Wälzer.pdf', makePdf(Array.from({ length: 1000 }, (_, i) => [`Marke${i + 1}`])))
    await indexPending()
    expect((await search('marke400')).files.map((f) => f.page)).toEqual([400])
    expect((await search('marke401')).files).toEqual([])
    expect(await searchState(pdf.id)).toEqual({ state: 'done', pages: 400, reason: 'nur die ersten 400 Seiten' })
  })

  it('übersteht Suchanfragen mit Sonderzeichen', async () => {
    for (const q of ['"', '*', '(', 'a"b', 'NEAR(', '-', '^x']) {
      expect((await search(q)).files).toEqual([])
    }
  })

  it('entfernt die Treffer beim Löschen der Datei', async () => {
    const pdf = await upload('Löschen.pdf', makePdf([['Vergänglichkeit']]))
    await indexPending()
    expect((await search('vergänglich')).files).toHaveLength(1)
    await call(attachment.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: pdf.id } })
    expect((await search('vergänglich')).files).toEqual([])
    expect(ftsRows(pdf.id)).toBe(0)
  })

  it('liest Dateien erneut und holt den Bestand beim Serverstart nach', async () => {
    const pdf = await upload('Bestand.pdf', makePdf([['Altbestand']]))
    await indexPending()
    // Wie ein Upload, der vor einem Neustart nicht mehr gelesen wurde
    getDb().prepare('DELETE FROM attachments_fts WHERE attachment_id = ?').run(pdf.id)
    getDb().prepare('DELETE FROM attachments_index WHERE attachment_id = ?').run(pdf.id)
    expect(await searchState(pdf.id)).toEqual({ state: 'pending', pages: 0, reason: null })
    expect(indexMissing()).toBe(1)
    await indexPending()
    expect((await search('altbestand')).files.map((f) => f.id)).toEqual([pdf.id])

    const r = await call(reindex.POST, '/', { cookie: token, params: { id: pdf.id } })
    expect(r.data.search).toEqual({ state: 'done', pages: 1, reason: null })
    expect(ftsRows(pdf.id)).toBe(1)
    const png = await upload('Bild.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    expect((await call(reindex.POST, '/', { cookie: token, params: { id: png.id } })).status).toBe(400)
  })

  it('zeigt Treffer nur dem Besitzer der Datei', async () => {
    await call(users.POST, '/api/admin/users', { cookie: token, body: { username: 'suchgast', password: 'Kennwort-Such-111' } })
    let other = await loginAs('suchgast', 'Kennwort-Such-111')
    await call(password.POST, '/', {
      cookie: other,
      body: { currentPassword: 'Kennwort-Such-111', newPassword: 'Kennwort-Such-222' },
    })
    other = await loginAs('suchgast', 'Kennwort-Such-222')
    const mine = await upload('Geheim.pdf', makePdf([['Geheimrezept']]))
    const theirs = await upload('Fremd.pdf', makePdf([['Geheimrezept']]), other)
    await indexPending()
    expect((await search('geheimrezept')).files.map((f) => f.id)).toEqual([mine.id])
    expect((await search('geheimrezept', other)).files.map((f) => f.id)).toEqual([theirs.id])
    expect((await call(reindex.POST, '/', { cookie: other, params: { id: mine.id } })).status).toBe(404)
    // Notizen bleiben getrennt durchsuchbar
    await call(notes.POST, '/api/notes', { cookie: other, body: { title: 'Rezept', content: 'Geheimrezept', folderId: null } })
    expect((await search('geheimrezept', other)).results).toHaveLength(1)

    // Konto löschen entfernt auch den Suchindex der Dateien
    const list = await call(users.GET, '/api/admin/users', { cookie: token })
    const id = (list.data.users as { id: number; username: string }[]).find((u) => u.username === 'suchgast')!.id
    expect((await call(user.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: String(id) } })).status).toBe(200)
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM attachments_fts WHERE user_id = ?').get(id)).toEqual({ n: 0 })
    expect(ftsRows(mine.id)).toBe(1)
  })
})
