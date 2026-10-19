import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
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
import * as versions from '@/app/api/notes/[id]/versions/route'
import * as version from '@/app/api/notes/[id]/versions/[versionId]/route'
import * as restoreVersion from '@/app/api/notes/[id]/versions/[versionId]/restore/route'
import { getDb } from '@/shared/server/db'
import { MAX_VERSIONS_PER_NOTE, VERSION_MAX_AGE, purgeVersions } from './server/versions'

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

describe('Mindmap und Canvas', () => {
  async function create(title: string, content: string, format: string) {
    return call(notes.POST, '/api/notes', { cookie: token, body: { title, content, format } })
  }
  const canvas = (nodes: object[], edges: object[] = []) => JSON.stringify({ nodes, edges })
  const box = { x: 0, y: 0, width: 200, height: 100 }

  it('speichert Mindmaps als Markdown und indiziert sie wie Markdown', async () => {
    const r = await create('Lernplan', '---\nmindmap-plugin: basic\n---\n\n# Lernplan\n\n## Analysis #mathe\n- [[Grenzwerte]]\n', 'mindmap')
    expect(r.status).toBe(201)
    expect(r.data.note).toMatchObject({ format: 'mindmap', tags: ['mathe'], excerpt: 'Lernplan Analysis #mathe Grenzwerte' })
    const bl = await call(backlinks.GET, '/', { cookie: token, params: { id: (await newNote('Grenzwerte')).id } })
    expect(bl.data.backlinks.map((b: { id: string }) => b.id)).toContain(r.data.note.id)
  })

  it('indiziert den Text der Karten eines Canvas und lehnt kaputte Canvas-Dateien ab', async () => {
    const content = canvas([
      { id: 'a', type: 'text', text: 'Thermodynamik #physik', ...box },
      { id: 'b', type: 'file', file: 'Wärmelehre', ...box, x: 300 },
      { id: 'c', type: 'group', label: 'Kapitel 1', ...box, width: 1000, height: 400 },
    ])
    const r = await create('Übersicht', content, 'canvas')
    expect(r.status).toBe(201)
    expect(r.data.note).toMatchObject({ format: 'canvas', tags: ['physik'] })
    expect(r.data.note.content).toBe(content)
    const found = await call(search.GET, '/', { cookie: token, query: { q: 'thermodynamik' } })
    expect(found.data.results.map((x: { id: string }) => x.id)).toContain(r.data.note.id)
    // JSON-Bestandteile sind nicht durchsuchbar
    const json = await call(search.GET, '/', { cookie: token, query: { q: 'width' } })
    expect(json.data.results.map((x: { id: string }) => x.id)).not.toContain(r.data.note.id)
    const bl = await call(backlinks.GET, '/', { cookie: token, params: { id: (await newNote('Wärmelehre')).id } })
    expect(bl.data.backlinks.map((b: { id: string }) => b.id)).toContain(r.data.note.id)

    expect((await create('Kaputt', '{"nodes": [', 'canvas')).status).toBe(400)
    // Format wechseln ohne umgewandelten Inhalt: Markdown ist kein Canvas
    const md = await newNote('Text', '# Hallo')
    const change = await call(note.PUT, '/', { method: 'PUT', cookie: token, params: { id: md.id }, body: { format: 'canvas' } })
    expect(change.status).toBe(400)
    expect((await create('Leer', '', 'canvas')).status).toBe(201)
  })

  it('passt Textkarten und Notiz-Karten im Canvas beim Umbenennen an', async () => {
    const target = await newNote('Optik Grundlagen')
    const r = await create(
      'Pinnwand',
      canvas([
        { id: 'a', type: 'text', text: 'Siehe [[Optik Grundlagen|Optik]]', ...box },
        { id: 'b', type: 'file', file: 'Optik Grundlagen', subpath: '#Linsen', ...box, x: 300 },
        { id: 'c', type: 'file', file: 'Folie.png', ...box, x: 600 },
      ]),
      'canvas',
    )
    const ren = await call(note.PUT, '/', { method: 'PUT', cookie: token, params: { id: target.id }, body: { title: 'Wellenoptik' } })
    expect(ren.data.linksUpdated).toBe(2)
    const after = await call(note.GET, '/', { cookie: token, params: { id: r.data.note.id } })
    const nodes = JSON.parse(after.data.note.content).nodes
    expect(nodes.map((n: { text?: string; file?: string }) => n.text ?? n.file)).toEqual([
      'Siehe [[Wellenoptik|Optik]]',
      'Wellenoptik',
      'Folie.png',
    ])
    expect(nodes[1].subpath).toBe('#Linsen')
  })

  it('bietet ein Canvas als .canvas mit Pfaden wie im Export zum Download an', async () => {
    const dir = await newFolder('Physik')
    await newNote('Impuls', '', dir.id)
    const r = await create('Mechanik', canvas([{ id: 'a', type: 'file', file: 'Impuls', ...box }]), 'canvas')
    const d = await call(download.GET, '/', { cookie: token, params: { id: r.data.note.id } })
    expect(d.res.headers.get('content-type')).toMatch(/application\/json/)
    expect(d.res.headers.get('content-disposition')).toContain(encodeURIComponent('Mechanik.canvas'))
    // Der Testhelfer liest JSON-Antworten bereits aus
    expect(d.data.nodes[0].file).toBe('Physik/Impuls.md')
  })
})

describe('Versionsverlauf', () => {
  const MINUTE = 60_000
  afterEach(() => vi.useRealTimers())

  const put = (id: string, body: Record<string, unknown>, cookie = token) =>
    call(note.PUT, '/', { method: 'PUT', cookie, params: { id }, body })
  const history = async (id: string) => {
    const r = await call(versions.GET, '/', { cookie: token, params: { id } })
    expect(r.status).toBe(200)
    return r.data.versions as { id: number; version: number; title: string; reason: string; size: number }[]
  }

  it('sichert beim Tippen höchstens alle 10 Minuten den bisherigen Stand', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const start = Date.now()
    const n = await newNote('Mitschrift Optik', 'Stand A')
    // Gleich nach dem Anlegen entsteht noch kein Eintrag – sonst stünden halb getippte Anfänge im Verlauf
    await put(n.id, { content: 'Stand A1' })
    expect(await history(n.id)).toEqual([])

    vi.setSystemTime(start + 11 * MINUTE)
    for (let i = 0; i < 10; i++) {
      vi.setSystemTime(start + 11 * MINUTE + i * 5_000)
      expect((await put(n.id, { content: `Stand B${i}` })).status).toBe(200)
    }
    const first = await history(n.id)
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ reason: 'edit', title: 'Mitschrift Optik', size: 'Stand A1'.length })
    const detail = await call(version.GET, '/', { cookie: token, params: { id: n.id, versionId: String(first[0].id) } })
    expect(detail.data.version.content).toBe('Stand A1')

    vi.setSystemTime(start + 22 * MINUTE)
    await put(n.id, { content: 'Stand C' })
    const second = await history(n.id)
    expect(second).toHaveLength(2)
    const latest = await call(version.GET, '/', { cookie: token, params: { id: n.id, versionId: String(second[0].id) } })
    expect(latest.data.version.content).toBe('Stand B9')
    // Titel ändern oder Anheften sichert nichts
    vi.setSystemTime(start + 40 * MINUTE)
    await put(n.id, { title: 'Optik', pinned: true })
    expect(await history(n.id)).toHaveLength(2)
  })

  it('sichert vor Formatwechsel und beim Überschreiben nach einem Konflikt immer', async () => {
    const n = await newNote('Konfliktfall', '# Original')
    const converted = await put(n.id, { format: 'text', content: 'Original' })
    expect(converted.status).toBe(200)
    const overwritten = await put(n.id, {
      content: 'Meine Version',
      baseVersion: converted.data.note.version,
      reason: 'conflict',
    })
    expect(overwritten.status).toBe(200)
    const list = await history(n.id)
    expect(list.map((v) => v.reason)).toEqual(['conflict', 'format'])
    const formatVersion = await call(version.GET, '/', { cookie: token, params: { id: n.id, versionId: String(list[1].id) } })
    expect(formatVersion.data.version).toMatchObject({ format: 'markdown', content: '# Original' })
    const bad = await put(n.id, { content: 'x', reason: 'restore' })
    expect(bad.status).toBe(400)
  })

  it('stellt Titel, Format und Inhalt wieder her und indiziert die Notiz neu', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const start = Date.now()
    const target = await newNote('Chlorophyll', 'Farbstoff')
    const n = await newNote('Photosynthese', 'Lichtreaktion in [[Chlorophyll]] #bio/zelle')
    vi.setSystemTime(start + 11 * MINUTE)
    const changed = await put(n.id, { title: 'Umbau', format: 'text', content: 'Nur noch Stichworte' })
    expect(changed.data.note.tags).toEqual([])
    const [old] = await history(n.id)
    expect(old).toMatchObject({ reason: 'format', title: 'Photosynthese' })

    const r = await call(restoreVersion.POST, '/', { cookie: token, params: { id: n.id, versionId: String(old.id) } })
    expect(r.status).toBe(200)
    expect(r.data.note).toMatchObject({
      title: 'Photosynthese',
      format: 'markdown',
      content: 'Lichtreaktion in [[Chlorophyll]] #bio/zelle',
      tags: ['bio/zelle'],
      version: changed.data.note.version + 1,
    })
    const s = await call(search.GET, '/', { cookie: token, query: { q: 'lichtreaktion' } })
    expect(s.data.results.map((x: { id: string }) => x.id)).toEqual([n.id])
    const bl = await call(backlinks.GET, '/', { cookie: token, params: { id: target.id } })
    expect(bl.data.backlinks.map((b: { id: string }) => b.id)).toContain(n.id)
    // Der überschriebene Stand bleibt im Verlauf
    const list = await history(n.id)
    expect(list[0]).toMatchObject({ reason: 'restore', title: 'Umbau' })
  })

  it('liefert für fremde Notizen, fremde und ungültige Stände 404', async () => {
    const n = await newNote('Privat', '# Privat')
    await put(n.id, { format: 'text', content: 'Privat' })
    const [v] = await history(n.id)
    const other = await newNote('Andere Notiz')

    await call(users.POST, '/api/admin/users', { cookie: token, body: { username: 'zweiter', password: 'Kennwort-Abc-111' } })
    const second = await loginAs('zweiter', 'Kennwort-Abc-111')
    await call(password.POST, '/', {
      cookie: second,
      body: { currentPassword: 'Kennwort-Abc-111', newPassword: 'Kennwort-Abc-222' },
    })
    const params = { id: n.id, versionId: String(v.id) }
    expect((await call(versions.GET, '/', { cookie: second, params: { id: n.id } })).status).toBe(404)
    expect((await call(version.GET, '/', { cookie: second, params })).status).toBe(404)
    expect((await call(restoreVersion.POST, '/', { cookie: second, params })).status).toBe(404)

    // Stand einer anderen Notiz und unsinnige Nummern
    const wrongNote = { id: other.id, versionId: String(v.id) }
    expect((await call(version.GET, '/', { cookie: token, params: wrongNote })).status).toBe(404)
    for (const versionId of ['abc', '0', '-1', '1.5', '99999999']) {
      expect((await call(version.GET, '/', { cookie: token, params: { id: n.id, versionId } })).status).toBe(404)
    }
  })

  it(`behält höchstens ${MAX_VERSIONS_PER_NOTE} Stände und entfernt Stände nach 90 Tagen`, async () => {
    const n = await newNote('Oft umgewandelt', 'Text')
    for (let i = 0; i < MAX_VERSIONS_PER_NOTE + 5; i++) {
      expect((await put(n.id, { format: i % 2 === 0 ? 'text' : 'markdown', content: `Text ${i}` })).status).toBe(200)
    }
    const list = await history(n.id)
    expect(list).toHaveLength(MAX_VERSIONS_PER_NOTE)
    // Die ältesten fallen weg: Der älteste verbliebene Stand ist der nach fünf Wechseln
    expect(list.at(-1)!.version).toBe(6)

    purgeVersions(Date.now() + VERSION_MAX_AGE - MINUTE)
    expect(await history(n.id)).toHaveLength(MAX_VERSIONS_PER_NOTE)
    purgeVersions(Date.now() + VERSION_MAX_AGE + MINUTE)
    expect(await history(n.id)).toEqual([])
  })

  it('entfernt die Stände beim endgültigen Löschen und zeigt im Papierkorb keinen Verlauf', async () => {
    const n = await newNote('Weg damit', 'Text')
    await put(n.id, { format: 'text' })
    expect(await history(n.id)).toHaveLength(1)
    await call(note.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: n.id } })
    expect((await call(versions.GET, '/', { cookie: token, params: { id: n.id } })).status).toBe(404)
    await call(note.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: n.id }, query: { permanent: '1' } })
    const left = getDb().prepare('SELECT COUNT(*) AS n FROM note_versions WHERE note_id = ?').get(n.id) as { n: number }
    expect(left.n).toBe(0)
  })
})
