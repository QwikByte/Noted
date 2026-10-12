import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { unzipSync, strFromU8, zipSync, strToU8 } from 'fflate'
import { ADMIN_PASSWORD, call, loginAs, setupTestEnv } from './helpers'
import * as notes from '@/app/api/notes/route'
import * as note from '@/app/api/notes/[id]/route'
import * as restore from '@/app/api/notes/[id]/restore/route'
import * as backlinks from '@/app/api/notes/[id]/backlinks/route'
import * as download from '@/app/api/notes/[id]/download/route'
import * as folders from '@/app/api/folders/route'
import * as folder from '@/app/api/folders/[id]/route'
import * as search from '@/app/api/search/route'
import * as tags from '@/app/api/tags/route'
import * as trash from '@/app/api/trash/route'
import * as attachments from '@/app/api/attachments/route'
import * as attachment from '@/app/api/attachments/[id]/route'
import * as files from '@/app/api/files/[...name]/route'
import * as exportRoute from '@/app/api/export/route'
import * as importRoute from '@/app/api/import/route'
import * as users from '@/app/api/admin/users/route'
import * as password from '@/app/api/account/password/route'

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

describe('Ordner und Notizen', () => {
  it('legt Ordner an und verhindert doppelte Namen', async () => {
    const sem = await newFolder('Semester 1')
    await newFolder('Analysis I', sem.id)
    const dup = await call(folders.POST, '/api/folders', { cookie: token, body: { name: 'semester 1', parentId: null } })
    expect(dup.status).toBe(409)
    const bad = await call(folders.POST, '/api/folders', { cookie: token, body: { name: 'a/b', parentId: null } })
    expect(bad.status).toBe(400)
  })

  it('verhindert Ordner-Zyklen', async () => {
    const a = await newFolder('A')
    const b = await newFolder('B', a.id)
    const r = await call(folder.PATCH, '/', { method: 'PATCH', cookie: token, params: { id: a.id }, body: { parentId: b.id } })
    expect(r.status).toBe(400)
  })

  it('erstellt Notizen, vergibt bei gleichem Titel automatisch einen freien Namen und indiziert Tags', async () => {
    const a = await newNote('Vorlesung', '---\ntags:\n  - mathe\n---\nText mit #analysis/folgen')
    expect(a.tags).toEqual(['analysis/folgen', 'mathe'])
    const b = await newNote('vorlesung')
    expect(b.title).toBe('vorlesung 1')
  })

  it('übernimmt eine vom Client erzeugte ID (Offline-Erstellung) und ist idempotent', async () => {
    const id = crypto.randomUUID()
    const r1 = await call(notes.POST, '/api/notes', { cookie: token, body: { id, title: 'Offline', content: 'x' } })
    const r2 = await call(notes.POST, '/api/notes', { cookie: token, body: { id, title: 'Offline', content: 'x' } })
    expect(r1.data.note.id).toBe(id)
    expect(r2.data.note.id).toBe(id)
    expect(r2.data.note.title).toBe('Offline')
  })

  it('erkennt Versionskonflikte zwischen Geräten', async () => {
    const n = await newNote('Konflikt', 'v1')
    const ok = await call(note.PUT, '/', {
      method: 'PUT',
      cookie: token,
      params: { id: n.id },
      body: { content: 'v2', baseVersion: n.version },
    })
    expect(ok.status).toBe(200)
    expect(ok.data.note.version).toBe(n.version + 1)
    const stale = await call(note.PUT, '/', {
      method: 'PUT',
      cookie: token,
      params: { id: n.id },
      body: { content: 'v2-anderes-gerät', baseVersion: n.version },
    })
    expect(stale.status).toBe(409)
    expect(stale.data.error).toBe('version_conflict')
    expect(stale.data.note.content).toBe('v2')
    // Anheften ändert die Version nicht
    const pin = await call(note.PUT, '/', { method: 'PUT', cookie: token, params: { id: n.id }, body: { pinned: true } })
    expect(pin.data.note.pinned).toBe(true)
    expect(pin.data.note.version).toBe(ok.data.note.version)
  })

  it('aktualisiert Wikilinks in anderen Notizen beim Umbenennen', async () => {
    const target = await newNote('Grenzwerte', 'Inhalt')
    const src = await newNote('Übersicht', 'Siehe [[Grenzwerte]], [[Grenzwerte|GW]] und [[Grenzwerte#Definition]].')
    const r = await call(note.PUT, '/', {
      method: 'PUT',
      cookie: token,
      params: { id: target.id },
      body: { title: 'Grenzwerte von Folgen' },
    })
    expect(r.status).toBe(200)
    expect(r.data.linksUpdated).toBe(3)
    const updated = await call(note.GET, '/', { cookie: token, params: { id: src.id } })
    expect(updated.data.note.content).toBe(
      'Siehe [[Grenzwerte von Folgen]], [[Grenzwerte von Folgen|GW]] und [[Grenzwerte von Folgen#Definition]].',
    )
    const bl = await call(backlinks.GET, '/', { cookie: token, params: { id: target.id } })
    expect(bl.data.backlinks.map((b: { id: string }) => b.id)).toEqual([src.id])
  })

  it('lehnt ungültige oder doppelte Titel beim Umbenennen ab', async () => {
    const a = await newNote('Eins')
    await newNote('Zwei')
    const dup = await call(note.PUT, '/', { method: 'PUT', cookie: token, params: { id: a.id }, body: { title: 'zwei' } })
    expect(dup.status).toBe(409)
    expect(dup.data.error).toBe('title_taken')
    const bad = await call(note.PUT, '/', { method: 'PUT', cookie: token, params: { id: a.id }, body: { title: 'a:b' } })
    expect(bad.status).toBe(400)
    const auto = await call(note.PUT, '/', {
      method: 'PUT',
      cookie: token,
      params: { id: a.id },
      body: { title: 'zwei', autoRename: true },
    })
    expect(auto.data.note.title).toBe('zwei 1')
  })

  it('bietet Notizen als .md-Datei zum Download an', async () => {
    const n = await newNote('Download Ä', '# Hallo')
    const r = await call(download.GET, '/', { cookie: token, params: { id: n.id } })
    expect(r.res.headers.get('content-type')).toMatch(/text\/markdown/)
    expect(r.res.headers.get('content-disposition')).toContain(encodeURIComponent('Download Ä.md'))
    expect(await r.res.text()).toBe('# Hallo')
  })
})

describe('Suche und Tags', () => {
  it('findet Notizen über Volltext (inkl. Präfix und Umlaute) und Tags', async () => {
    await newNote('Lineare Algebra', 'Eigenwerte und Eigenvektoren einer Matrix #mathe/la')
    await newNote('Physik', 'Größen und Einheiten')
    const r1 = await call(search.GET, '/', { cookie: token, query: { q: 'eigenw' } })
    expect(r1.data.results[0].title).toBe('Lineare Algebra')
    expect(r1.data.results[0].snippet).toContain('\u0002')
    // Akzente/Umlaute werden ignoriert: „gro“ findet „Größen“
    const r2 = await call(search.GET, '/', { cookie: token, query: { q: 'gro' } })
    expect(r2.data.results.map((r: { title: string }) => r.title)).toContain('Physik')
    const r3 = await call(search.GET, '/', { cookie: token, query: { q: '#mathe' } })
    expect(r3.data.results.map((r: { title: string }) => r.title)).toEqual(
      expect.arrayContaining(['Lineare Algebra', 'Vorlesung']),
    )
    const r4 = await call(search.GET, '/', { cookie: token, query: { q: '"(' } })
    expect(r4.status).toBe(200)
    const t = await call(tags.GET, '/', { cookie: token })
    expect(t.data.tags).toEqual(expect.arrayContaining([{ tag: 'mathe/la', count: 1 }]))
  })

  it('zeigt Notizen anderer Benutzer nie an', async () => {
    const created = await call(users.POST, '/api/admin/users', {
      cookie: token,
      body: { username: 'fremd', password: 'Kennwort-Xyz-111' },
    })
    expect(created.status).toBe(201)
    const other = await loginAs('fremd', 'Kennwort-Xyz-111')
    await call(password.POST, '/', {
      cookie: other,
      body: { currentPassword: 'Kennwort-Xyz-111', newPassword: 'Kennwort-Xyz-222' },
    })
    const list = await call(notes.GET, '/', { cookie: other })
    expect(list.data.notes).toEqual([])
    const s = await call(search.GET, '/', { cookie: other, query: { q: 'Eigenwerte' } })
    expect(s.data.results).toEqual([])
    const mine = await call(notes.GET, '/', { cookie: token })
    const foreignAccess = await call(note.GET, '/', { cookie: other, params: { id: mine.data.notes[0].id } })
    expect(foreignAccess.status).toBe(404)
  })
})

describe('Papierkorb', () => {
  it('verschiebt in den Papierkorb und stellt wieder her', async () => {
    const n = await newNote('Wegwerfen', 'temporär suchbar')
    await call(note.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: n.id } })
    expect((await call(note.GET, '/', { cookie: token, params: { id: n.id } })).status).toBe(404)
    const s = await call(search.GET, '/', { cookie: token, query: { q: 'temporär' } })
    expect(s.data.results).toEqual([])
    const t = await call(trash.GET, '/', { cookie: token })
    expect(t.data.notes.map((x: { id: string }) => x.id)).toContain(n.id)
    const r = await call(restore.POST, '/', { cookie: token, params: { id: n.id } })
    expect(r.data.note.title).toBe('Wegwerfen')
    const s2 = await call(search.GET, '/', { cookie: token, query: { q: 'temporär' } })
    expect(s2.data.results).toHaveLength(1)
  })

  it('löscht Ordner und verschiebt enthaltene Notizen in den Papierkorb', async () => {
    const f = await newFolder('Alt')
    const sub = await newFolder('Unterordner', f.id)
    const n = await newNote('In Unterordner', '', sub.id)
    const r = await call(folder.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: f.id } })
    expect(r.data.trashedNotes).toBe(1)
    const list = await call(folders.GET, '/', { cookie: token })
    expect(list.data.folders.map((x: { id: string }) => x.id)).not.toContain(sub.id)
    const restored = await call(restore.POST, '/', { cookie: token, params: { id: n.id } })
    expect(restored.data.note.folderId).toBeNull()
  })

  it('leert den Papierkorb', async () => {
    const n = await newNote('Endgültig')
    await call(note.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: n.id } })
    const r = await call(trash.DELETE, '/', { method: 'DELETE', cookie: token })
    expect(r.data.deleted).toBeGreaterThanOrEqual(1)
    expect((await call(trash.GET, '/', { cookie: token })).data.notes).toEqual([])
  })
})

describe('Anhänge', () => {
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

describe('Export und Import (Obsidian-Vault)', () => {
  it('exportiert Notizen mit Ordnerstruktur und Anhängen als ZIP', async () => {
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

  it('importiert ein Vault-ZIP inkl. Ordnern und überspringt .obsidian', async () => {
    const vault = zipSync({
      'Mein Vault/Uni/Mathe.md': strToU8('# Mathe\n#import'),
      'Mein Vault/Uni/bild.jpg': new Uint8Array([1, 2, 3]),
      'Mein Vault/.obsidian/app.json': strToU8('{}'),
      'Mein Vault/Notiz:mit:Doppelpunkt.md': strToU8('x'),
    })
    const form = new FormData()
    form.append('files', new File([vault], 'vault.zip', { type: 'application/zip' }))
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
      const vault = zipSync({ 'klein.md': strToU8('ok'), 'riesig.bin': new Uint8Array(3 * 1024 * 1024) })
      const form = new FormData()
      form.append('files', new File([vault], 'v.zip'))
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
})
