import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ADMIN_PASSWORD, call, loginAs, setupTestEnv } from '@/tests/helpers'
import * as notes from '@/app/api/notes/route'
import * as note from '@/app/api/notes/[id]/route'
import * as tags from '@/app/api/tags/route'
import * as rename from '@/app/api/tags/rename/route'
import * as search from '@/app/api/search/route'
import * as versions from '@/app/api/notes/[id]/versions/route'
import * as users from '@/app/api/admin/users/route'
import * as password from '@/app/api/account/password/route'
import { getDb } from '@/shared/server/db'
import type { Note, NoteFormat } from './types'

let env: Awaited<ReturnType<typeof setupTestEnv>>
let token = ''

beforeAll(async () => {
  env = await setupTestEnv()
  token = await loginAs('admin', ADMIN_PASSWORD)
})
afterAll(() => env.cleanup())

async function newNote(title: string, content: string, format: NoteFormat = 'markdown', cookie = token) {
  const r = await call(notes.POST, '/', { cookie, body: { title, content, format } })
  expect(r.status).toBe(201)
  return r.data.note as Note
}

const load = async (id: string, cookie = token) => (await call(note.GET, '/', { cookie, params: { id } })).data.note as Note
const renameTag = (from: string, to: string, cookie = token) => call(rename.POST, '/', { cookie, body: { from, to } })
const tagList = async (cookie = token) =>
  ((await call(tags.GET, '/', { cookie })).data.tags as { tag: string; count: number }[]).map((t) => t.tag)

describe('Tags umbenennen', () => {
  it('benennt den Tag im Text, in den Properties und in Unter-Tags um und sichert den Stand vorher', async () => {
    const a = await newNote('Folgen', '---\ntags: [Mathe, uni]\n---\n# Folgen\n\nText mit #Mathe/Analysis und `#mathe`')
    const b = await newNote('Reihen', 'Nur #mathe hier, #mathematik bleibt')
    const other = await newNote('Anderes', 'Kein Tag hier, nur #physik')

    const r = await renameTag('#Mathe', 'Studium/Mathe')
    expect(r.status).toBe(200)
    expect(r.data).toEqual({ notes: 2 })

    const after = await load(a.id)
    expect(after.content).toBe('---\ntags: [Studium/Mathe, uni]\n---\n# Folgen\n\nText mit #Studium/Mathe/Analysis und `#mathe`')
    expect(after.tags).toEqual(['studium/mathe', 'studium/mathe/analysis', 'uni'])
    expect(after.version).toBe(a.version + 1)
    expect((await load(b.id)).content).toBe('Nur #Studium/Mathe hier, #mathematik bleibt')
    expect((await load(other.id)).version).toBe(other.version)

    const tagNames = await tagList()
    expect(tagNames).not.toContain('mathe')
    expect(tagNames).toContain('studium/mathe/analysis')
    expect(tagNames).toContain('mathematik')

    // Der alte Stand liegt im Verlauf, die Suche findet den neuen Namen
    const history = (await call(versions.GET, '/', { cookie: token, params: { id: a.id } })).data.versions
    expect(history).toMatchObject([{ version: a.version, reason: 'edit' }])
    const found = await call(search.GET, '/', { cookie: token, query: { q: '#studium/mathe' } })
    expect((found.data.results as { id: string }[]).map((n) => n.id).sort()).toEqual([a.id, b.id].sort())
  })

  it('führt zwei Tags zusammen', async () => {
    const a = await newNote('Lineare Algebra', '#la Vektorräume')
    const b = await newNote('LinA', '#lineare-algebra Matrizen')
    const r = await renameTag('la', 'lineare-algebra')
    expect(r.data).toEqual({ notes: 1 })
    expect((await load(a.id)).tags).toEqual(['lineare-algebra'])
    expect((await load(b.id)).version).toBe(b.version)
    expect(await tagList()).not.toContain('la')
  })

  it('ändert formatierten Text und Karten auf dem Whiteboard', async () => {
    const rich = await newNote('Formatiert', '<p>#chemie und <code>#chemie</code></p><p style="color: #ff0000">#chemie/organisch</p>', 'richtext')
    const canvas = await newNote(
      'Tafel',
      JSON.stringify({ nodes: [{ id: 'n1', type: 'text', x: 0, y: 0, width: 200, height: 80, text: 'Notiz #chemie' }], edges: [] }),
      'canvas',
    )
    expect((await renameTag('chemie', 'Biochemie')).data).toEqual({ notes: 2 })
    expect((await load(rich.id)).content).toBe(
      '<p>#Biochemie und <code>#chemie</code></p><p style="color: #ff0000">#Biochemie/organisch</p>',
    )
    const after = await load(canvas.id)
    expect(JSON.parse(after.content).nodes[0].text).toBe('Notiz #Biochemie')
    expect(after.tags).toEqual(['biochemie'])
  })

  it('lässt Notizen im Papierkorb und im Tresor unverändert', async () => {
    const trashed = await newNote('Weg', '#geschichte Rom')
    expect((await call(note.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: trashed.id } })).status).toBe(200)
    const locked = await newNote('Geheim', '#geschichte Athen')
    // Der Server kann Tresor-Notizen nicht lesen – auch wenn noch ein Tag dazu gespeichert wäre
    getDb().prepare('UPDATE notes SET vault = 1 WHERE id = ?').run(locked.id)
    expect((await renameTag('geschichte', 'antike')).data).toEqual({ notes: 0 })
    const rows = getDb().prepare('SELECT content FROM notes WHERE id IN (?, ?)').all(trashed.id, locked.id) as { content: string }[]
    expect(rows.map((r) => r.content).sort()).toEqual(['#geschichte Athen', '#geschichte Rom'])
  })

  it('weist ungültige Namen ab und tut nichts, wenn sich nur die Schreibweise ändert', async () => {
    const n = await newNote('Englisch', '#englisch Vokabeln')
    expect((await renameTag('englisch', '2024')).status).toBe(400)
    expect((await renameTag('englisch', 'mit leerzeichen')).status).toBe(400)
    expect((await renameTag('englisch', '')).status).toBe(400)
    expect((await renameTag('englisch', 'x'.repeat(201))).status).toBe(400)
    expect((await renameTag('Englisch', '#englisch/')).data).toEqual({ notes: 0 })
    expect((await load(n.id)).version).toBe(n.version)
  })

  it('ändert nur die eigenen Notizen und verlangt Anmeldung und CSRF-Schutz', async () => {
    await call(users.POST, '/api/admin/users', { cookie: token, body: { username: 'zweite', password: 'Kennwort-Abc-111' } })
    const second = await loginAs('zweite', 'Kennwort-Abc-111')
    await call(password.POST, '/', {
      cookie: second,
      body: { currentPassword: 'Kennwort-Abc-111', newPassword: 'Kennwort-Abc-222' },
    })
    const mine = await newNote('Admin', '#latein Text')
    const theirs = await newNote('Zweite', '#latein Text', 'markdown', second)

    expect((await renameTag('latein', 'sprachen', second)).data).toEqual({ notes: 1 })
    expect((await load(theirs.id, second)).tags).toEqual(['sprachen'])
    expect((await load(mine.id)).tags).toEqual(['latein'])

    expect((await call(rename.POST, '/', { cookie: null, body: { from: 'latein', to: 'x' } })).status).toBe(401)
    expect((await call(rename.POST, '/', { cookie: token, csrf: false, body: { from: 'latein', to: 'x' } })).status).toBe(403)
    expect((await load(mine.id)).tags).toEqual(['latein'])
  })
})
