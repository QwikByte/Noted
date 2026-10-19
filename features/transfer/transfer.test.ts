import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { unzipSync, strFromU8, zipSync, strToU8 } from 'fflate'
import { ADMIN_PASSWORD, call, loginAs, setupTestEnv } from '@/tests/helpers'
import * as notes from '@/app/api/notes/route'
import * as folders from '@/app/api/folders/route'
import * as attachments from '@/app/api/attachments/route'
import * as exportRoute from '@/app/api/export/route'
import * as importRoute from '@/app/api/import/route'
import * as calendar from '@/app/api/calendar/route'

let env: Awaited<ReturnType<typeof setupTestEnv>>
let token = ''

beforeAll(async () => {
  env = await setupTestEnv()
  token = await loginAs('admin', ADMIN_PASSWORD)
})
afterAll(() => env.cleanup())

async function newFolder(name: string, parentId: string | null = null) {
  const r = await call(folders.POST, '/api/folders', { cookie: token, body: { name, parentId } })
  expect(r.status).toBe(201)
  return r.data.folder as { id: string; name: string }
}

async function newNote(title: string, content = '', folderId: string | null = null) {
  const r = await call(notes.POST, '/api/notes', { cookie: token, body: { title, content, folderId } })
  expect(r.status).toBe(201)
  return r.data.note as { id: string; title: string; version: number; tags: string[] }
}

describe('Export und Import (ZIP)', () => {
  it('exportiert Notizen mit Ordnerstruktur und Anhängen als ZIP', async () => {
    const form = new FormData()
    form.append('file', new File([new Uint8Array([1, 2, 3])], 'Tafel-bild.png', { type: 'image/png' }))
    expect((await call(attachments.POST, '/', { cookie: token, form })).status).toBe(201)
    const sem = await newFolder('Export Semester')
    const fach = await newFolder('Fach', sem.id)
    await newNote('Skript', 'Bild: ![[Tafel-bild.png]]', fach.id)
    await newFolder('Leer')
    const r = await call(exportRoute.GET, '/', { cookie: token })
    expect(r.res.headers.get('content-type')).toBe('application/zip')
    const zip = unzipSync(new Uint8Array(await r.res.arrayBuffer()))
    expect(strFromU8(zip['Export Semester/Fach/Skript.md'])).toBe('Bild: ![[Tafel-bild.png]]')
    expect(zip['Anhänge/Tafel-bild.png']).toBeDefined()
    expect(Object.keys(zip)).toContain('Leer/')
  })

  it('importiert ein ZIP inkl. Ordnern und überspringt versteckte Ordner', async () => {
    const zip = zipSync({
      'Meine Notizen/Uni/Mathe.md': strToU8('# Mathe\n#import'),
      'Meine Notizen/Uni/bild.jpg': new Uint8Array([1, 2, 3]),
      'Meine Notizen/.config/app.json': strToU8('{}'),
      'Meine Notizen/Notiz:mit:Doppelpunkt.md': strToU8('x'),
    })
    const form = new FormData()
    form.append('files', new File([zip], 'notizen.zip', { type: 'application/zip' }))
    form.append('files', new File(['Einzeln'], 'Einzelne Datei.md'))
    const r = await call(importRoute.POST, '/', { cookie: token, form })
    expect(r.status).toBe(200)
    expect(r.data).toMatchObject({ notes: 3, attachments: 1, folders: 2 })
    const list = await call(notes.GET, '/', { cookie: token })
    const titles = list.data.notes.map((n: { title: string }) => n.title)
    expect(titles).toEqual(expect.arrayContaining(['Mathe', 'Notiz-mit-Doppelpunkt', 'Einzelne Datei']))
    const mathe = list.data.notes.find((n: { title: string }) => n.title === 'Mathe')
    expect(mathe.tags).toEqual(['import'])
  })

  it('überspringt zu große Einträge im ZIP, ohne sie zu entpacken', async () => {
    process.env.MAX_UPLOAD_MB = '1'
    try {
      const zip = zipSync({ 'klein.md': strToU8('ok'), 'riesig.bin': new Uint8Array(3 * 1024 * 1024) })
      const form = new FormData()
      form.append('files', new File([zip], 'v.zip'))
      const r = await call(importRoute.POST, '/', { cookie: token, form })
      expect(r.status).toBe(200)
      expect(r.data.notes).toBe(1)
      expect(r.data.skipped).toEqual(['riesig.bin (zu groß)'])
    } finally {
      delete process.env.MAX_UPLOAD_MB
    }
  })

  it('lehnt kaputte ZIP-Dateien ab', async () => {
    const form = new FormData()
    form.append('files', new File([new Uint8Array([1, 2, 3])], 'kaputt.zip'))
    const r = await call(importRoute.POST, '/', { cookie: token, form })
    expect(r.status).toBe(400)
  })

  it('exportiert formatierten Text als HTML (Bilder relativ zu „Anhänge“) und einfachen Text als .md', async () => {
    const folder = await newFolder('Formate')
    const rich = await call(notes.POST, '/api/notes', {
      cookie: token,
      body: { title: 'Bericht', folderId: folder.id, format: 'richtext', content: '<p>Bild:</p><img src="/api/files/Tafel-bild.png" alt="x">' },
    })
    expect(rich.status).toBe(201)
    await call(notes.POST, '/api/notes', { cookie: token, body: { title: 'Liste', folderId: folder.id, format: 'text', content: 'a\nb' } })
    const r = await call(exportRoute.GET, '/', { cookie: token })
    const zip = unzipSync(new Uint8Array(await r.res.arrayBuffer()))
    const html = strFromU8(zip['Formate/Bericht.html'])
    expect(html).toMatch(/^<!doctype html>/)
    expect(html).toContain('<img src="../Anh%C3%A4nge/Tafel-bild.png" alt="x">')
    expect(strFromU8(zip['Formate/Liste.md'])).toBe('a\nb')
  })

  it('importiert HTML-Dateien als formatierten Text – außer im Ordner „Anhänge“', async () => {
    const page = '<!doctype html><html><head><title>x</title></head><body><h1>Import</h1><img src="../Anhänge/foto.png"></body></html>'
    const zip = zipSync({
      'Ordner/Seite.html': strToU8(page),
      'Anhänge/eingebettet.html': strToU8('<p>bleibt Anhang</p>'),
    })
    const form = new FormData()
    form.append('files', new File([zip], 'export.zip'))
    const r = await call(importRoute.POST, '/', { cookie: token, form })
    expect(r.data).toMatchObject({ notes: 1, attachments: 1 })
    const list = await call(notes.GET, '/', { cookie: token })
    const imported = list.data.notes.find((n: { title: string }) => n.title === 'Seite')
    expect(imported.format).toBe('richtext')
    const { GET } = await import('@/app/api/notes/[id]/route')
    const full = await call(GET, '/', { cookie: token, params: { id: imported.id } })
    expect(full.data.note.content).toBe('<h1>Import</h1><img src="/api/files/foto.png">')
  })

  it('exportiert Mindmaps als .md und Canvas als .canvas mit vollständigen Pfaden – und importiert beides wieder', async () => {
    const folder = await newFolder('Visuell')
    const target = await newNote('Zielnotiz', '', folder.id)
    const mindmap = '---\nmindmap-plugin: basic\n---\n\n# Plan\n\n## Ast\n'
    await call(notes.POST, '/api/notes', { cookie: token, body: { title: 'Plan', folderId: folder.id, format: 'mindmap', content: mindmap } })
    const box = { x: 0, y: 0, width: 100, height: 100 }
    const canvas = JSON.stringify({
      nodes: [
        { id: 'a', type: 'file', file: target.title, ...box },
        { id: 'b', type: 'file', file: 'Tafel-bild.png', ...box },
        { id: 'c', type: 'text', text: '[[Zielnotiz]]', ...box },
      ],
      edges: [{ id: 'e', fromNode: 'a', toNode: 'c' }],
    })
    const c = await call(notes.POST, '/api/notes', { cookie: token, body: { title: 'Brett', folderId: folder.id, format: 'canvas', content: canvas } })
    expect(c.status).toBe(201)

    const r = await call(exportRoute.GET, '/', { cookie: token })
    const zip = unzipSync(new Uint8Array(await r.res.arrayBuffer()))
    expect(strFromU8(zip['Visuell/Plan.md'])).toBe(mindmap)
    const exported = JSON.parse(strFromU8(zip['Visuell/Brett.canvas']))
    expect(exported.nodes.map((n: { file?: string; text?: string }) => n.file ?? n.text)).toEqual([
      'Visuell/Zielnotiz.md',
      'Anhänge/Tafel-bild.png',
      '[[Zielnotiz]]',
    ])
    expect(exported.edges).toHaveLength(1)

    // Wieder einspielen: Dateikarten verweisen wie Wikilinks auf den Namen, Mindmaps erkennt das Property
    const form = new FormData()
    form.append(
      'files',
      new File([zipSync({ 'Neu/Brett.canvas': zip['Visuell/Brett.canvas'], 'Neu/Plan.md': zip['Visuell/Plan.md'], 'Neu/Kaputt.canvas': strToU8('{') })], 'v.zip'),
    )
    const imp = await call(importRoute.POST, '/', { cookie: token, form })
    expect(imp.data.notes).toBe(2)
    expect(imp.data.skipped).toEqual(['Neu/Kaputt.canvas (Kein gültiges Canvas.)'])
    const list = await call(notes.GET, '/', { cookie: token })
    const neu = (await call(folders.GET, '/', { cookie: token })).data.folders.find((f: { name: string }) => f.name === 'Neu')
    const inNeu = list.data.notes.filter((n: { folderId: string }) => n.folderId === neu.id)
    expect(inNeu.map((n: { title: string; format: string }) => `${n.title}:${n.format}`).sort()).toEqual(['Brett:canvas', 'Plan:mindmap'])
    const { GET } = await import('@/app/api/notes/[id]/route')
    const brett = inNeu.find((n: { title: string }) => n.title === 'Brett')
    const full = await call(GET, '/', { cookie: token, params: { id: brett.id } })
    expect(JSON.parse(full.data.note.content).nodes.map((n: { file?: string }) => n.file).filter(Boolean)).toEqual([
      'Zielnotiz',
      'Tafel-bild.png',
    ])
  })

  it('exportiert die Termine als Kalender.ics und liest .ics-Dateien in den Kalender ein', async () => {
    const lecture = {
      title: 'Analysis I',
      location: 'Hörsaal 1',
      notes: '',
      color: 2,
      allDay: false,
      start: '2026-10-19T10:15',
      end: '2026-10-19T11:45',
      repeat: { weeks: 1, until: null },
      exdates: [],
    }
    expect((await call(calendar.POST, '/api/calendar', { cookie: token, body: lecture })).status).toBe(201)
    const r = await call(exportRoute.GET, '/', { cookie: token })
    const zip = unzipSync(new Uint8Array(await r.res.arrayBuffer()))
    const ics = strFromU8(zip['Kalender.ics'])
    expect(ics).toContain('SUMMARY:Analysis I')
    expect(ics).toContain('RRULE:FREQ=WEEKLY')

    // Der eigene Export legt nichts doppelt an; eine .ics im Ordner „Anhänge“ bleibt ein Anhang
    const uni = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:la@uni',
      'SUMMARY:Lineare Algebra',
      'DTSTART:20261020T061500Z',
      'DTEND:20261020T074500Z',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:kaputt@uni',
      'SUMMARY:Ohne Beginn',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    const form = new FormData()
    form.append('files', new File([zipSync({ 'Kalender.ics': zip['Kalender.ics'], 'Anhänge/Einladung.ics': strToU8(uni) })], 'v.zip'))
    form.append('files', new File([uni], 'Stundenplan.ics', { type: 'text/calendar' }))
    form.append('timeZone', 'Europe/Berlin')
    const imp = await call(importRoute.POST, '/', { cookie: token, form })
    expect(imp.status).toBe(200)
    expect(imp.data).toMatchObject({ events: 1, attachments: 1, skipped: ['Stundenplan.ics (1 Termin nicht lesbar oder abgesagt)'] })
    const events = (await call(calendar.GET, '/api/calendar', { cookie: token })).data.events
    // 06:15 UTC ist 08:15 in Berlin
    expect(events.map((e: { title: string; start: string }) => `${e.title} ${e.start}`)).toEqual([
      'Analysis I 2026-10-19T10:15',
      'Lineare Algebra 2026-10-20T08:15',
    ])
  })
})
