import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ADMIN_PASSWORD, call, loginAs, setupTestEnv } from '@/tests/helpers'
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

describe('Formate', () => {
  async function newFormatted(title: string, content: string, format: string) {
    const r = await call(notes.POST, '/api/notes', { cookie: token, body: { title, content, format } })
    expect(r.status).toBe(201)
    return r.data.note as { id: string; title: string; version: number; tags: string[]; excerpt: string; format: string }
  }

  it('legt Notizen standardmäßig als Markdown an und lehnt unbekannte Formate ab', async () => {
    const plain = await call(notes.POST, '/api/notes', { cookie: token, body: { title: 'Ohne Format', content: '# x' } })
    expect(plain.data.note.format).toBe('markdown')
    const bad = await call(notes.POST, '/api/notes', { cookie: token, body: { title: 'Falsch', format: 'docx' } })
    expect(bad.status).toBe(400)
  })

  it('indiziert formatierten Text ohne HTML: Auszug, Tags, Links und Suche', async () => {
    const html = '<h2>Kapitel</h2><p>Die <strong>Quantenmechanik</strong> &amp; mehr #physik siehe [[Optik]]</p><p style="color: red">span</p>'
    const n = await newFormatted('Formatiert', html, 'richtext')
    expect(n.format).toBe('richtext')
    expect(n.excerpt).toBe('Kapitel Die Quantenmechanik & mehr #physik siehe Optik span')
    expect(n.tags).toEqual(['physik'])
    const found = await call(search.GET, '/', { cookie: token, query: { q: 'quanten' } })
    expect(found.data.results.map((r: { id: string }) => r.id)).toContain(n.id)
    expect(found.data.results.find((r: { id: string }) => r.id === n.id).snippet).not.toContain('<strong>')
    // HTML-Bestandteile sind nicht durchsuchbar
    const tagNames = await call(search.GET, '/', { cookie: token, query: { q: 'strong' } })
    expect(tagNames.data.results.map((r: { id: string }) => r.id)).not.toContain(n.id)
    const bl = await call(backlinks.GET, '/', { cookie: token, params: { id: (await newNote('Optik')).id } })
    expect(bl.data.backlinks.map((b: { id: string }) => b.id)).toContain(n.id)
  })

  it('wechselt das Format samt umgewandeltem Inhalt und erkennt Konflikte', async () => {
    const n = await newFormatted('Wechsel', '# Titel\n\nText', 'markdown')
    const r = await call(note.PUT, '/', {
      method: 'PUT',
      cookie: token,
      params: { id: n.id },
      body: { content: '<h1>Titel</h1><p>Text</p>', format: 'richtext', baseVersion: n.version },
    })
    expect(r.status).toBe(200)
    expect(r.data.note).toMatchObject({ format: 'richtext', version: n.version + 1, excerpt: 'Titel Text' })
    // Nur das Format zu ändern ist ebenfalls eine Änderung (Version steigt, alter Stand → Konflikt)
    const stale = await call(note.PUT, '/', {
      method: 'PUT',
      cookie: token,
      params: { id: n.id },
      body: { format: 'text', baseVersion: n.version },
    })
    expect(stale.status).toBe(409)
  })

  it('bietet formatierten Text als HTML-Dokument und einfachen Text als .md zum Download an', async () => {
    const rich = await newFormatted('Bericht & Co', '<p>Hallo <em>Welt</em></p>', 'richtext')
    const r = await call(download.GET, '/', { cookie: token, params: { id: rich.id } })
    expect(r.res.headers.get('content-type')).toMatch(/text\/html/)
    expect(r.res.headers.get('content-disposition')).toMatch(/^attachment;.*\.html/)
    expect(r.res.headers.get('content-security-policy')).toContain('sandbox')
    const body = await r.res.text()
    expect(body).toContain('<title>Bericht &amp; Co</title>')
    expect(body).toContain('<p>Hallo <em>Welt</em></p>')

    const plain = await newFormatted('Einkauf', '# keine Überschrift', 'text')
    const p = await call(download.GET, '/', { cookie: token, params: { id: plain.id } })
    expect(p.res.headers.get('content-disposition')).toContain(encodeURIComponent('Einkauf.md'))
    expect(await p.res.text()).toBe('# keine Überschrift')
  })

  it('passt Wikilinks in formatiertem Text beim Umbenennen an (auch mit „&“ im Titel)', async () => {
    const target = await newNote('Tom & Jerry')
    const src = await newFormatted('Verweis', '<p>Siehe [[Tom &amp; Jerry]] und [[Tom &amp; Jerry|die beiden]]</p>', 'richtext')
    const r = await call(note.PUT, '/', { method: 'PUT', cookie: token, params: { id: target.id }, body: { title: 'Katz & Maus' } })
    expect(r.data.linksUpdated).toBe(2)
    const after = await call(note.GET, '/', { cookie: token, params: { id: src.id } })
    expect(after.data.note.content).toBe('<p>Siehe [[Katz &amp; Maus]] und [[Katz &amp; Maus|die beiden]]</p>')
  })
})
