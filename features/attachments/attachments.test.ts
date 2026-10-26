import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ADMIN_PASSWORD, call, loginAs, setupTestEnv } from '@/tests/helpers'
import * as attachments from '@/app/api/attachments/route'
import * as attachment from '@/app/api/attachments/[id]/route'
import * as files from '@/app/api/files/[...name]/route'
import * as notes from '@/app/api/notes/route'
import * as note from '@/app/api/notes/[id]/route'
import * as references from '@/app/api/attachments/[id]/references/route'
import * as users from '@/app/api/admin/users/route'
import * as password from '@/app/api/account/password/route'
import { getDb } from '@/shared/server/db'
import { filePageReferences, fileReferences } from './references'

let env: Awaited<ReturnType<typeof setupTestEnv>>
let token = ''

beforeAll(async () => {
  env = await setupTestEnv()
  token = await loginAs('admin', ADMIN_PASSWORD)
})
afterAll(() => env.cleanup())

describe('Dateien', () => {
  it('lädt Dateien hoch, vergibt eindeutige Namen und liefert sie per Name aus', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    const form = new FormData()
    form.append('file', new File([png], 'Tafel:bild.png', { type: 'image/png' }))
    const r = await call(attachments.POST, '/', { cookie: token, form })
    expect(r.status).toBe(201)
    expect(r.data.attachment.filename).toBe('Tafel-bild.png')

    const form2 = new FormData()
    form2.append('file', new File([png], 'Tafel-bild.png', { type: 'image/png' }))
    const r2 = await call(attachments.POST, '/', { cookie: token, form: form2 })
    expect(r2.data.attachment.filename).toBe('Tafel-bild 1.png')

    const byName = await call(files.GET, '/', { cookie: token, params: { name: ['tafel-bild.png'] } })
    expect(byName.status).toBe(200)
    expect(byName.res.headers.get('content-type')).toBe('image/png')
    expect(byName.res.headers.get('content-security-policy')).toContain('sandbox')
    expect(new Uint8Array(await byName.res.arrayBuffer())).toEqual(png)

    const range = await call(attachment.GET, '/', {
      cookie: token,
      params: { id: r.data.attachment.id },
      headers: { range: 'bytes=1-3' },
    })
    expect(range.status).toBe(206)
    expect(new Uint8Array(await range.res.arrayBuffer())).toEqual(png.slice(1, 4))
  })

  it('übernimmt keine MIME-Typen des Browsers für unbekannte Endungen', async () => {
    const form = new FormData()
    form.append('file', new File(['alert(1)'], 'skript.js', { type: 'text/javascript' }))
    const r = await call(attachments.POST, '/', { cookie: token, form })
    expect(r.data.attachment.mime).toBe('application/octet-stream')
  })

  it('lehnt zu große Uploads ab, ohne sie komplett einzulesen', async () => {
    process.env.MAX_UPLOAD_MB = '1'
    try {
      const form = new FormData()
      form.append('file', new File([new Uint8Array(2 * 1024 * 1024)], 'gross.bin'))
      const r = await call(attachments.POST, '/', { cookie: token, form })
      expect(r.status).toBe(413)
    } finally {
      delete process.env.MAX_UPLOAD_MB
    }
  })

  it('liefert HTML-Dateien nur als Download aus', async () => {
    const form = new FormData()
    form.append('file', new File(['<script>alert(1)</script>'], 'boese.html', { type: 'text/html' }))
    const r = await call(attachments.POST, '/', { cookie: token, form })
    const get = await call(attachment.GET, '/', { cookie: token, params: { id: r.data.attachment.id } })
    expect(get.res.headers.get('content-disposition')).toMatch(/^attachment/)
    expect(get.res.headers.get('content-type')).toBe('application/octet-stream')
  })
})

describe('Zuordnung von Dateien zu Notizen', () => {
  it('erkennt Einbettungen und Links in allen Formaten', () => {
    expect(fileReferences('markdown', '![[Foto.JPG|300]] [[Skript.pdf#page=3]] [[Andere Notiz]] `![[code.png]]`')).toEqual(
      new Set(['foto.jpg', 'skript.pdf']),
    )
    // Seitenlink aus dem PDF-Viewer nach dem Umwandeln in Markdown
    expect(fileReferences('markdown', '[Folien, S. 1](/api/files/Folien%20(1).pdf#page=1) [x](/api/files/a.png)')).toEqual(
      new Set(['folien (1).pdf', 'a.png']),
    )
    const html = '<p><img src="/api/files/Tafel%20bild.png" alt=""><a href="/api/files/Uni/Skript.pdf#page=2">S. 2</a></p>'
    expect(fileReferences('richtext', html)).toEqual(new Set(['tafel bild.png', 'skript.pdf']))
    const canvas = JSON.stringify({
      nodes: [
        { id: 'a', type: 'file', file: 'Ordner/plan.pdf', x: 0, y: 0, width: 100, height: 100 },
        { id: 'b', type: 'file', file: 'Notiz.md', x: 0, y: 200, width: 100, height: 100 },
        { id: 'c', type: 'text', text: '![[skizze.png]]', x: 200, y: 0, width: 100, height: 100 },
      ],
      edges: [],
    })
    expect(fileReferences('canvas', canvas)).toEqual(new Set(['plan.pdf', 'skizze.png']))
    expect(fileReferences('markdown', '/api/files/%E0%A4%A')).toEqual(new Set())
  })

  it('liefert zu jeder Datei die Notizen, die sie einbetten – ohne Papierkorb', async () => {
    const form = new FormData()
    form.append('file', new File([new Uint8Array([1, 2, 3])], 'Zuordnung.pdf'))
    const up = await call(attachments.POST, '/', { cookie: token, form })
    const filename = up.data.attachment.filename as string

    const create = async (title: string, content: string, format = 'markdown') =>
      (await call(notes.POST, '/api/notes', { cookie: token, body: { title, content, format } })).data.note as { id: string }
    const a = await create('Mit Einbettung', `![[${filename.toLowerCase()}]]`)
    const link = `<p><a href="/api/files/${encodeURIComponent(filename)}">Skript</a></p>`
    const b = await create('Formatiert', link, 'richtext')
    const c = await create('Gelöscht', `[[${filename}]]`)
    await call(note.DELETE, '/', { cookie: token, method: 'DELETE', params: { id: c.id } })

    const list = await call(attachments.GET, '/', { cookie: token, query: { notes: '1' } })
    const entry = list.data.attachments.find((f: { filename: string }) => f.filename === filename)
    expect(entry.noteIds.sort()).toEqual([a.id, b.id].sort())
    expect(list.data.attachments.find((f: { filename: string }) => f.filename === 'skript.js').noteIds).toEqual([])

    // Ohne ?notes=1 bleibt die Liste wie bisher (ohne die Notizen zu durchsuchen)
    const plain = await call(attachments.GET, '/', { cookie: token })
    expect(plain.data.attachments[0].noteIds).toBeUndefined()
  })
})

describe('Rückverweise im PDF-Viewer', () => {
  const pages = (format: 'markdown' | 'richtext' | 'canvas' | 'mindmap', content: string) =>
    Object.fromEntries([...filePageReferences(format, content)].map(([name, p]) => [name, [...p]]))

  it('liest die zitierten Seiten – null für die ganze Datei', () => {
    expect(pages('markdown', '[[Skript.pdf#page=12]] und ![[Ordner/skript.PDF]], dazu [[Skript.pdf#page=3|S. 3]]')).toEqual({
      'skript.pdf': [12, null, 3],
    })
    // Ein Abschnitt statt einer Seite zählt als ganze Datei, Code nicht
    expect(pages('markdown', '[[Skript.pdf#Kapitel 2]] `[[Code.pdf#page=1]]`')).toEqual({ 'skript.pdf': [null] })
    expect(pages('markdown', '[Folien, S. 4](/api/files/Folien%20(1).pdf#page=4)')).toEqual({ 'folien (1).pdf': [4] })
    const html = '<p><a href="/api/files/Uni/Skript.pdf#page=2">S. 2</a> <a href="/api/files/Skript.pdf">ganz</a></p>'
    expect(pages('richtext', html)).toEqual({ 'skript.pdf': [2, null] })
    const canvas = JSON.stringify({
      nodes: [{ id: 'a', type: 'file', file: 'Plan.pdf', subpath: '#page=3', x: 0, y: 0, width: 100, height: 100 }],
      edges: [],
    })
    expect(pages('canvas', canvas)).toEqual({ 'plan.pdf': [3] })
    expect(pages('mindmap', '---\nmindmap-plugin: basic\n---\n# Thema\n## Ast [[Skript.pdf#page=7]]')).toEqual({ 'skript.pdf': [7] })
  })

  it('liefert die Notizen mit ihren Seiten – ohne Papierkorb, Tresor und fremde Konten', async () => {
    const form = new FormData()
    form.append('file', new File([new Uint8Array([1, 2, 3])], 'Skript Wärme.pdf'))
    const id = (await call(attachments.POST, '/', { cookie: token, form })).data.attachment.id as string
    const create = async (title: string, content: string, format = 'markdown', cookie = token) =>
      (await call(notes.POST, '/api/notes', { cookie, body: { title, content, format } })).data.note as { id: string }

    const lecture = await create('Entropie Mitschrift', 'Siehe [[Skript Wärme.pdf#page=2]] und [[skript wärme.pdf#page=5]]')
    const summary = await create('Zusammenfassung', '![[Skript Wärme.pdf]] und [[Skript Wärme.pdf#page=2]]')
    const rich = await create('Formatierte Mitschrift', '<p><a href="/api/files/Skript%20W%C3%A4rme.pdf#page=9">S. 9</a></p>', 'richtext')
    await create('Ohne Verweis', 'Nichts zum Skript')
    const trashed = await create('Im Papierkorb', '[[Skript Wärme.pdf#page=2]]')
    await call(note.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: trashed.id } })
    const locked = await create('Im Tresor', '[[Skript Wärme.pdf#page=2]]')
    getDb().prepare('UPDATE notes SET vault = 1 WHERE id = ?').run(locked.id)

    const r = await call(references.GET, '/', { cookie: token, params: { id } })
    expect(r.status).toBe(200)
    expect(r.data.notes).toEqual([
      { id: lecture.id, title: 'Entropie Mitschrift', folderId: null, pages: [2, 5], whole: false },
      { id: rich.id, title: 'Formatierte Mitschrift', folderId: null, pages: [9], whole: false },
      { id: summary.id, title: 'Zusammenfassung', folderId: null, pages: [2], whole: true },
    ])

    await call(users.POST, '/api/admin/users', { cookie: token, body: { username: 'leserin', password: 'Kennwort-Abc-111' } })
    const other = await loginAs('leserin', 'Kennwort-Abc-111')
    await call(password.POST, '/', { cookie: other, body: { currentPassword: 'Kennwort-Abc-111', newPassword: 'Kennwort-Abc-222' } })
    await create('Fremd', '[[Skript Wärme.pdf#page=2]]', 'markdown', other)
    expect((await call(references.GET, '/', { cookie: other, params: { id } })).status).toBe(404)
    expect((await call(references.GET, '/', { cookie: null, params: { id } })).status).toBe(401)
    expect((await call(references.GET, '/', { cookie: token, params: { id } })).data.notes).toHaveLength(3)
  })
})
