import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { unzipSync, strFromU8, zipSync, strToU8 } from 'fflate'
import { ADMIN_PASSWORD, call, loginAs, setupTestEnv } from '@/tests/helpers'
import * as notes from '@/app/api/notes/route'
import * as folders from '@/app/api/folders/route'
import * as attachments from '@/app/api/attachments/route'
import * as exportRoute from '@/app/api/export/route'
import * as importRoute from '@/app/api/import/route'
import * as calendar from '@/app/api/calendar/route'
import * as decks from '@/app/api/decks/route'
import * as deckCards from '@/app/api/decks/[id]/cards/route'
import * as flashcards from '@/app/api/flashcards/route'
import * as users from '@/app/api/admin/users/route'
import * as password from '@/app/api/account/password/route'
import * as annotationsRoute from '@/app/api/attachments/[id]/annotations/route'
import { makePdf } from '@/tests/pdf'
import type { FlashcardData } from '@/features/flashcards/types'
import type { PdfAnnotation } from '@/features/pdf/types'

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
      exam: null,
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

  it('überträgt Karteikarten-Stapel verlustfrei – ohne Dubletten durch die .md daneben', async () => {
    const form = new FormData()
    form.append('file', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9])], 'Organ.png'))
    expect((await call(attachments.POST, '/', { cookie: token, form })).status).toBe(201)
    const deck = (await call(decks.POST, '/api/decks', { cookie: token, body: { name: 'Biologie', scheduler: 'fsrs' } })).data.deck
    const occlusion = { image: 'Organ.png', masks: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2, label: 'Leber' }], hideAll: false }
    await call(deckCards.POST, '/', {
      cookie: token,
      params: { id: deck.id },
      body: { cards: [{ type: 'basic', front: 'Zelle', back: 'Kleinste Einheit' }, { type: 'occlusion', front: 'Organe', occlusion }] },
    })
    const r = await call(exportRoute.GET, '/', { cookie: token })
    const exported = new Uint8Array(await r.res.arrayBuffer())
    const zip = unzipSync(exported)
    expect(zip['Karteikarten/Biologie.md']).toBeDefined()
    expect(Object.keys(unzipSync(zip['Karteikarten/Biologie.noted-deck.zip'])).sort()).toEqual(['deck.json', 'media/Organ.png'])

    // In ein neues Konto: der Stapel samt Bildverdeckung, keine Notiz „Biologie“ aus der .md, das Bild nur einmal
    await call(users.POST, '/api/admin/users', { cookie: token, body: { username: 'umzug', password: 'Zweites-Konto-Pw-1' } })
    const other = await loginAs('umzug', 'Zweites-Konto-Pw-1')
    await call(password.POST, '/', { cookie: other, body: { currentPassword: 'Zweites-Konto-Pw-1', newPassword: 'Zweites-Konto-Pw-2' } })
    const imp = new FormData()
    imp.append('files', new File([exported], 'Noted-Export.zip'))
    const res = await call(importRoute.POST, '/', { cookie: other, form: imp })
    expect(res.status).toBe(200)
    const own = ((await call(flashcards.GET, '/api/flashcards', { cookie: token })).data as FlashcardData).decks
    expect(res.data).toMatchObject({ decks: own.length })
    const theirs = (await call(flashcards.GET, '/api/flashcards', { cookie: other })).data as FlashcardData
    const bio = theirs.decks.find((d) => d.name === 'Biologie')!
    expect(bio.scheduler).toBe('fsrs')
    expect(theirs.cards.filter((c) => c.deckId === bio.id).map((c) => c.occlusion?.image ?? c.front)).toEqual(['Zelle', 'Organ.png'])
    const notesOfOther = (await call(notes.GET, '/api/notes', { cookie: other })).data.notes as { title: string }[]
    expect(notesOfOther.map((n) => n.title)).not.toContain('Biologie')
    const files = (await call(attachments.GET, '/api/attachments', { cookie: other })).data.attachments as { filename: string }[]
    expect(files.filter((f) => f.filename.startsWith('Organ'))).toEqual([expect.objectContaining({ filename: 'Organ.png' })])

    // Eine einzelne Stapel-Datei erkennt der Import ebenfalls
    const single = new FormData()
    single.append('files', new File([zip['Karteikarten/Biologie.noted-deck.zip']], 'Biologie.noted-deck.zip'))
    const one = await call(importRoute.POST, '/', { cookie: other, form: single })
    expect(one.data).toMatchObject({ notes: 0, decks: 1, cards: 2, attachments: 0 })
  })
})

describe('PDF-Anmerkungen in Export und Import', () => {
  const T = Date.UTC(2026, 9, 1)
  type Stored = Omit<PdfAnnotation, 'attachmentId'>
  const marks: Stored[] = [
    {
      id: crypto.randomUUID(),
      page: 2,
      rects: [[60.5, 700, 320, 716], [60.5, 682, 210.25, 698]],
      quote: 'Entropie nimmt zu',
      comment: 'Prüfungsrelevant',
      color: 1,
      createdAt: T + 1_000,
      updatedAt: T + 5_000,
    },
    { id: crypto.randomUUID(), page: 1, rects: [[72, 740, 300, 756]], quote: 'Energie bleibt erhalten', comment: '', color: 4, createdAt: T + 2_000, updatedAt: T + 2_000 },
  ]
  const comparable = (list: PdfAnnotation[]) =>
    list.map(({ page, rects, quote, comment, color, createdAt, updatedAt }) => ({ page, rects, quote, comment, color, createdAt, updatedAt }))

  async function uploadAs(cookie: string, name: string, data: Uint8Array) {
    const form = new FormData()
    form.append('file', new File([new Uint8Array(data)], name))
    const r = await call(attachments.POST, '/', { cookie, form })
    expect(r.status).toBe(201)
    return r.data.attachment as { id: string; filename: string }
  }
  const listOf = async (id: string, cookie: string) =>
    (await call(annotationsRoute.GET, '/', { cookie, params: { id } })).data.annotations as PdfAnnotation[]
  async function importZip(cookie: string, files: Record<string, Uint8Array>) {
    const form = new FormData()
    form.append('files', new File([zipSync(files)], 'Export.zip'))
    const r = await call(importRoute.POST, '/', { cookie, form })
    expect(r.status).toBe(200)
    return r.data as { attachments: number; annotations: number; skipped: string[] }
  }
  const filesOf = async (cookie: string) =>
    (await call(attachments.GET, '/api/attachments', { cookie })).data.attachments as { id: string; filename: string }[]

  let other = ''
  let exported: Record<string, Uint8Array> = {}
  let source = { id: '', filename: '' }

  beforeAll(async () => {
    source = await uploadAs(token, 'Thermo Anmerkungen.pdf', makePdf([['Energie bleibt erhalten'], ['Entropie nimmt zu']]))
    const r = await call(annotationsRoute.PUT, '/', { method: 'PUT', cookie: token, params: { id: source.id }, body: { annotations: marks } })
    expect(r.data).toEqual({ saved: 2 })
    exported = unzipSync(new Uint8Array(await (await call(exportRoute.GET, '/', { cookie: token })).res.arrayBuffer()))
    await call(users.POST, '/api/admin/users', { cookie: token, body: { username: 'skriptumzug', password: 'Skript-Umzug-Pw-1' } })
    const first = await loginAs('skriptumzug', 'Skript-Umzug-Pw-1')
    await call(password.POST, '/', { cookie: first, body: { currentPassword: 'Skript-Umzug-Pw-1', newPassword: 'Skript-Umzug-Pw-2' } })
    other = await loginAs('skriptumzug', 'Skript-Umzug-Pw-2')
  })

  it('exportiert die Anmerkungen zusätzlich als JSON mit Positionen und Farben', () => {
    const file = JSON.parse(strFromU8(exported['Anhänge/Thermo Anmerkungen.pdf.anmerkungen.json']))
    expect(file).toMatchObject({ format: 'noted-pdf-annotations', version: 1, file: 'Thermo Anmerkungen.pdf' })
    expect(file.annotations).toHaveLength(2)
    expect(file.annotations.find((a: Stored) => a.id === marks[0].id)).toEqual(marks[0])
    // Die lesbare Fassung bleibt
    expect(exported['Anhänge/Thermo Anmerkungen.pdf.anmerkungen.md']).toBeDefined()
  })

  it('übernimmt sie beim Import in ein anderes Konto – mit neuen IDs, ohne Dubletten beim zweiten Mal', async () => {
    const result = await importZip(other, {
      'Anhänge/Thermo Anmerkungen.pdf.anmerkungen.json': exported['Anhänge/Thermo Anmerkungen.pdf.anmerkungen.json'],
      'Anhänge/Thermo Anmerkungen.pdf': exported['Anhänge/Thermo Anmerkungen.pdf'],
    })
    expect(result).toMatchObject({ attachments: 1, annotations: 2, skipped: [] })
    const pdf = (await filesOf(other)).find((f) => f.filename === 'Thermo Anmerkungen.pdf')!
    const imported = await listOf(pdf.id, other)
    expect(comparable(imported)).toEqual(comparable(await listOf(source.id, token)))
    expect(imported.map((a) => a.id)).not.toContain(marks[0].id)
    expect(imported.map((a) => a.id)).not.toContain(marks[1].id)

    // Noch einmal derselbe Export: das PDF ist schon da, die Anmerkungen bleiben zwei
    await importZip(other, exported)
    expect(await listOf(pdf.id, other)).toHaveLength(2)
    // Die Anmerkungen im ersten Konto bleiben unberührt
    expect(comparable(await listOf(source.id, token))).toEqual(comparable(marks.map((m) => ({ ...m, attachmentId: source.id }))).reverse())
  })

  it('ein erneuter Import ins selbe Konto ergibt keine Dubletten – der neuere Stand gewinnt', async () => {
    const newer = JSON.parse(strFromU8(exported['Anhänge/Thermo Anmerkungen.pdf.anmerkungen.json']))
    newer.annotations[0].comment = 'Nach dem Umzug ergänzt'
    newer.annotations[0].updatedAt = T + 9_000
    const result = await importZip(token, {
      'Anhänge/Thermo Anmerkungen.pdf': exported['Anhänge/Thermo Anmerkungen.pdf'],
      'Anhänge/Thermo Anmerkungen.pdf.anmerkungen.json': strToU8(JSON.stringify(newer)),
    })
    expect(result.attachments).toBe(0)
    const list = await listOf(source.id, token)
    expect(list).toHaveLength(2)
    expect(list.find((a) => a.id === newer.annotations[0].id)?.comment).toBe('Nach dem Umzug ergänzt')
  })

  it('hängt die Anmerkungen an das umbenannte PDF, wenn es den Namen schon gibt', async () => {
    const third = await uploadAs(other, 'Gleichnamig.pdf', makePdf([['Ein ganz anderes Skript mit mehr Text darin']]))
    const file = JSON.parse(strFromU8(exported['Anhänge/Thermo Anmerkungen.pdf.anmerkungen.json']))
    file.file = 'Gleichnamig.pdf'
    const result = await importZip(other, {
      'Anhänge/Gleichnamig.pdf': exported['Anhänge/Thermo Anmerkungen.pdf'],
      'Anhänge/Gleichnamig.pdf.anmerkungen.json': strToU8(JSON.stringify(file)),
    })
    expect(result).toMatchObject({ attachments: 1, annotations: 2 })
    const renamed = (await filesOf(other)).find((f) => f.filename === 'Gleichnamig 1.pdf')!
    expect(await listOf(renamed.id, other)).toHaveLength(2)
    expect(await listOf(third.id, other)).toEqual([])
  })

  it('überspringt Anmerkungen ohne PDF und kaputte Dateien – der übrige Import läuft weiter', async () => {
    const json = exported['Anhänge/Thermo Anmerkungen.pdf.anmerkungen.json']
    const broken = JSON.parse(strFromU8(json))
    broken.annotations[0].rects = []
    const result = await importZip(other, {
      'Anhänge/Fehlt.pdf.anmerkungen.json': json,
      'Anhänge/Kaputt.pdf.anmerkungen.json': strToU8('{"format": "noted-pdf-annot'),
      'Anhänge/Leer.pdf.anmerkungen.json': strToU8(JSON.stringify({ ...broken, file: 'Leer.pdf' })),
      'Anhänge/Leer.pdf': makePdf([['Leer']]),
      'Anhänge/Fremd.anmerkungen.json': strToU8('{"format": "etwas anderes"}'),
      'Notiz nach Anmerkungen.md': strToU8('Weiter'),
    })
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        'Anhänge/Fehlt.pdf.anmerkungen.json (das PDF dazu fehlt im Archiv)',
        'Anhänge/Kaputt.pdf.anmerkungen.json (Die Anmerkungen-Datei ist beschädigt.)',
        'Anhänge/Leer.pdf.anmerkungen.json (Eine Markierung braucht mindestens eine Textzeile.)',
      ]),
    )
    expect(result.annotations).toBe(0)
    // Eine andere JSON-Datei mit diesem Namen bleibt ein gewöhnlicher Anhang, die Notiz kommt trotzdem an
    expect((await filesOf(other)).map((f) => f.filename)).toEqual(expect.arrayContaining(['Fremd.anmerkungen.json', 'Leer.pdf']))
    const titles = (await call(notes.GET, '/api/notes', { cookie: other })).data.notes.map((n: { title: string }) => n.title)
    expect(titles).toContain('Notiz nach Anmerkungen')
  })
})
