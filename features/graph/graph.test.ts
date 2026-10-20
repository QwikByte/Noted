import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ADMIN_PASSWORD, call, loginAs, setupTestEnv } from '@/tests/helpers'
import * as graph from '@/app/api/graph/route'
import * as notes from '@/app/api/notes/route'
import * as note from '@/app/api/notes/[id]/route'
import * as restore from '@/app/api/notes/[id]/restore/route'
import * as users from '@/app/api/admin/users/route'
import * as password from '@/app/api/account/password/route'
import type { GraphData } from './types'

let env: Awaited<ReturnType<typeof setupTestEnv>>
let token = ''

beforeAll(async () => {
  env = await setupTestEnv()
  token = await loginAs('admin', ADMIN_PASSWORD)
})
afterAll(() => env.cleanup())

async function newNote(title: string, content = '') {
  const r = await call(notes.POST, '/api/notes', { cookie: token, body: { title, content, folderId: null } })
  expect(r.status).toBe(201)
  return r.data.note as { id: string; title: string }
}

async function load(cookie = token): Promise<GraphData> {
  const r = await call(graph.GET, '/api/graph', { cookie })
  expect(r.status).toBe(200)
  return r.data as GraphData
}

const titles = (g: GraphData, ids: string[]) => ids.map((id) => g.nodes.find((n) => n.id === id)?.title)
const edgeTitles = (g: GraphData) => g.edges.map((e) => titles(g, [e.source, e.target]).join(' → ')).sort()

describe('Graph der Wikilinks', () => {
  it('liefert Notizen als Knoten und Wikilinks als Kanten – je Richtung genau eine', async () => {
    const a = await newNote('Analysis', 'Siehe [[Übungen]] und nochmal [[übungen|hier]] #mathe/ana')
    const b = await newNote('Übungen', 'Zurück zu [[Analysis#Folgen]] und zu [[Gibt es nicht]] und [[Übungen]]')
    const c = await newNote('Insel', 'Ohne Links')
    const g = await load()
    expect(g.nodes.map((n) => n.title)).toEqual(['Analysis', 'Insel', 'Übungen'])
    expect(edgeTitles(g)).toEqual(['Analysis → Übungen', 'Übungen → Analysis'])
    const byId = new Map(g.nodes.map((n) => [n.id, n]))
    expect(byId.get(a.id)).toMatchObject({ folderId: null, tags: ['mathe/ana'], links: 2 })
    expect(byId.get(b.id)!.links).toBe(2)
    expect(byId.get(c.id)!.links).toBe(0)
  })

  it('folgt Umbenennungen und lässt Notizen im Papierkorb weg', async () => {
    const target = await newNote('Grenzwert', 'Inhalt')
    const src = await newNote('Folgen', 'Mit [[Grenzwert]]')
    await call(note.PUT, '/', { method: 'PUT', cookie: token, params: { id: target.id }, body: { title: 'Limes' } })
    let g = await load()
    expect(edgeTitles(g)).toContain('Folgen → Limes')

    await call(note.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: target.id } })
    g = await load()
    expect(g.nodes.map((n) => n.id)).not.toContain(target.id)
    expect(g.edges.some((e) => e.target === target.id || e.source === target.id)).toBe(false)
    expect(g.nodes.find((n) => n.id === src.id)!.links).toBe(0)

    await call(restore.POST, '/', { cookie: token, params: { id: target.id } })
    expect(edgeTitles(await load())).toContain('Folgen → Limes')
  })

  it('zeigt anderen Nutzern nie fremde Notizen', async () => {
    await call(users.POST, '/api/admin/users', { cookie: token, body: { username: 'graphgast', password: 'Kennwort-Gra-111' } })
    const other = await loginAs('graphgast', 'Kennwort-Gra-111')
    await call(password.POST, '/', {
      cookie: other,
      body: { currentPassword: 'Kennwort-Gra-111', newPassword: 'Kennwort-Gra-222' },
    })
    // Gleicher Titel wie eine Notiz des Admins: Der Link darf nicht zu dessen Notiz führen
    await call(notes.POST, '/api/notes', { cookie: other, body: { title: 'Eigenes', content: '[[Analysis]]', folderId: null } })
    const g = await load(other)
    expect(g.nodes.map((n) => n.title)).toEqual(['Eigenes'])
    expect(g.edges).toEqual([])
    expect((await call(graph.GET, '/api/graph')).status).toBe(401)
  })
})
