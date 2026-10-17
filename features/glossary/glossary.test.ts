import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ADMIN_PASSWORD, call, loginAs, setupTestEnv } from '@/tests/helpers'
import * as notes from '@/app/api/notes/route'
import * as note from '@/app/api/notes/[id]/route'
import * as folders from '@/app/api/folders/route'
import * as glossary from '@/app/api/glossary/route'
import * as users from '@/app/api/admin/users/route'
import * as password from '@/app/api/account/password/route'
import { buildGlossary, glossaryToMarkdown, initialOf } from './glossary'
import type { Glossary } from './types'

const ANALYSIS = [
  '---',
  'tags: [analysis]',
  '---',
  '**Satz**: Begriff vor der ersten Überschrift',
  '# Folgen',
  '> [!info] Grenzwert',
  '> Eine Zahl, der sich die Folge beliebig nähert.',
  '',
  '- **Nullfolge**: Folge mit Grenzwert 0',
  '',
  '$$',
  '\\lim_{n\\to\\infty} a_n = a',
  '$$',
  '## Reihen',
  'Die Summe $$\\sum_{k=1}^n a_k$$ heißt Partialsumme.',
  '```',
  '$$ kein Code $$',
  '**Code**: zählt nicht',
  '```',
].join('\n')

describe('Glossar aus Notizen', () => {
  it('sammelt Definitionen alphabetisch und Formeln mit der Überschrift darüber', () => {
    const g = buildGlossary([
      { id: 'n1', title: 'Analysis I', text: ANALYSIS },
      { id: 'n2', title: 'Algebra', text: '## Gruppen\n**Abelsch**: kommutative Gruppe\n$$ab = ba$$' },
    ])
    expect(g.terms.map((t) => [t.term, t.noteTitle, t.heading])).toEqual([
      ['Abelsch', 'Algebra', 'Gruppen'],
      ['Grenzwert', 'Analysis I', 'Folgen'],
      ['Nullfolge', 'Analysis I', 'Folgen'],
      ['Satz', 'Analysis I', null],
    ])
    expect(g.terms[1].definition).toBe('Eine Zahl, der sich die Folge beliebig nähert.')
    // Formeln nach Notiz (alphabetisch) und Reihenfolge – Code-Blöcke zählen nicht
    expect(g.formulas.map((f) => [f.noteTitle, f.heading, f.tex])).toEqual([
      ['Algebra', 'Gruppen', 'ab = ba'],
      ['Analysis I', 'Folgen', '\\lim_{n\\to\\infty} a_n = a'],
      ['Analysis I', 'Reihen', '\\sum_{k=1}^n a_k'],
    ])
    expect(g.truncated).toBe(false)
  })

  it('gliedert Begriffe nach Anfangsbuchstaben', () => {
    expect(['Ärger', 'apfel', '**Zahl**', '3-Körper', 'ßtest', '$\\epsilon$-Umgebung'].map(initialOf)).toEqual([
      'A',
      'A',
      'Z',
      '#',
      'S',
      'E',
    ])
  })

  it('gibt Markdown mit Links zurück an die Stelle aus', () => {
    const g = buildGlossary([{ id: 'n1', title: 'Analysis I', text: ANALYSIS }])
    const md = glossaryToMarkdown('Glossar – Analysis', g.terms.slice(0, 1), g.formulas.slice(0, 1))
    expect(md).toBe(
      [
        '# Glossar – Analysis',
        '## Begriffe',
        '**Grenzwert** · [[Analysis I#Folgen]]\nEine Zahl, der sich die Folge beliebig nähert.',
        '## Formeln',
        '### [[Analysis I]]',
        'Folgen · [[Analysis I#Folgen]]\n$$\n\\lim_{n\\to\\infty} a_n = a\n$$',
      ].join('\n\n') + '\n',
    )
  })
})

describe('Glossar über die API', () => {
  let env: Awaited<ReturnType<typeof setupTestEnv>>
  let token = ''

  beforeAll(async () => {
    env = await setupTestEnv()
    token = await loginAs('admin', ADMIN_PASSWORD)
  })
  afterAll(() => env.cleanup())

  const get = async (query: Record<string, string> = {}, cookie = token) => call(glossary.GET, '/', { cookie, query })

  it('nur eigene Notizen, wahlweise ein Ordner samt Unterordnern, ohne Papierkorb und formatierten Text', async () => {
    const folder = async (name: string, parentId: string | null = null) =>
      (await call(folders.POST, '/api/folders', { cookie: token, body: { name, parentId } })).data.folder as { id: string }
    const create = async (title: string, content: string, folderId: string | null, format = 'markdown') =>
      (await call(notes.POST, '/api/notes', { cookie: token, body: { title, content, folderId, format } })).data.note as { id: string }
    const sem = await folder('Semester 1')
    const ana = await folder('Analysis', sem.id)
    await create('Folgen', '**Grenzwert**: Zahl a', ana.id)
    await create('Ohne Ordner', '**Lose**: ohne Ordner', null)
    await create('Formatiert', '<p><strong>Fett</strong>: kein Markdown</p>', sem.id, 'richtext')
    const gone = await create('Gelöscht', '**Weg**: im Papierkorb', sem.id)
    await call(note.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: gone.id } })

    const all = (await get()).data as Glossary
    expect(all.terms.map((t) => t.term)).toEqual(['Grenzwert', 'Lose'])
    const inSemester = (await get({ folder: sem.id })).data as Glossary
    expect(inSemester.terms.map((t) => t.term)).toEqual(['Grenzwert'])
    expect((await get({ folder: 'kein-ordner' })).status).toBe(400)
    expect((await get({ folder: crypto.randomUUID() })).status).toBe(404)

    await call(users.POST, '/api/admin/users', { cookie: token, body: { username: 'lea', password: 'Lea-Passwort-1234' } })
    const lea = await loginAs('lea', 'Lea-Passwort-1234')
    await call(password.POST, '/', { cookie: lea, body: { currentPassword: 'Lea-Passwort-1234', newPassword: 'Lea-Passwort-5678' } })
    expect((await get({}, lea)).data).toEqual({ terms: [], formulas: [], truncated: false })
    expect((await get({ folder: sem.id }, lea)).status).toBe(404)
  })
})
