import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { ADMIN_PASSWORD, call, loginAs, setupTestEnv } from '@/tests/helpers'
import * as flashcards from '@/app/api/flashcards/route'
import * as decks from '@/app/api/decks/route'
import * as deck from '@/app/api/decks/[id]/route'
import * as deckCards from '@/app/api/decks/[id]/cards/route'
import * as progress from '@/app/api/decks/[id]/progress/route'
import * as card from '@/app/api/cards/[id]/route'
import * as reviews from '@/app/api/reviews/route'
import * as exportRoute from '@/app/api/export/route'
import * as users from '@/app/api/admin/users/route'
import * as password from '@/app/api/account/password/route'
import { schedule } from './srs'
import type { Card, CardReview, Deck, FlashcardData } from './types'

let env: Awaited<ReturnType<typeof setupTestEnv>>
let token = ''

beforeAll(async () => {
  env = await setupTestEnv()
  token = await loginAs('admin', ADMIN_PASSWORD)
})
afterAll(() => env.cleanup())

async function newDeck(name: string, extra: Partial<Deck> = {}) {
  const r = await call(decks.POST, '/api/decks', { cookie: token, body: { name, ...extra } })
  expect(r.status).toBe(201)
  return r.data.deck as Deck
}

async function addCards(deckId: string, cards: unknown[], cookie = token) {
  return call(deckCards.POST, '/', { cookie, params: { id: deckId }, body: { cards } })
}

async function data(cookie = token) {
  const r = await call(flashcards.GET, '/api/flashcards', { cookie })
  expect(r.status).toBe(200)
  return r.data as FlashcardData
}

describe('Stapel', () => {
  it('legt Stapel an, verhindert doppelte Namen und speichert Einstellungen', async () => {
    const d = await newDeck('Analysis I', { description: 'Klausur', newPerDay: 15 })
    expect(d).toMatchObject({ name: 'Analysis I', description: 'Klausur', newPerDay: 15 })
    const dup = await call(decks.POST, '/api/decks', { cookie: token, body: { name: '  analysis   i ' } })
    expect(dup.status).toBe(409)
    const empty = await call(decks.POST, '/api/decks', { cookie: token, body: { name: '  ' } })
    expect(empty.status).toBe(400)
    const r = await call(deck.PATCH, '/', { method: 'PATCH', cookie: token, params: { id: d.id }, body: { name: 'Analysis 1', newPerDay: 30 } })
    expect(r.data.deck).toMatchObject({ name: 'Analysis 1', newPerDay: 30, description: 'Klausur' })
  })

  it('ist ohne Anmeldung und ohne CSRF-Header nicht nutzbar', async () => {
    expect((await call(flashcards.GET, '/api/flashcards')).status).toBe(401)
    expect((await call(decks.POST, '/api/decks', { cookie: token, body: { name: 'X' }, csrf: false })).status).toBe(403)
  })
})

describe('Karten', () => {
  it('legt Karten aller Arten an und prüft Multiple Choice', async () => {
    const d = await newDeck('Vokabeln')
    const noteId = crypto.randomUUID()
    const r = await addCards(d.id, [
      { type: 'basic', front: ' Haus ', back: 'house', noteId },
      { type: 'reversed', front: 'Baum', back: 'tree' },
      {
        type: 'mc',
        front: 'Welche sind Primzahlen?',
        back: 'Eins ist keine Primzahl.',
        options: [
          { text: '1', correct: false },
          { text: '2', correct: true },
          { text: ' ', correct: true },
          { text: '3', correct: true },
        ],
      },
    ])
    expect(r.status).toBe(201)
    const cards = r.data.cards as Card[]
    expect(cards.map((c) => [c.type, c.front, c.position])).toEqual([
      ['basic', 'Haus', 0],
      ['reversed', 'Baum', 1],
      ['mc', 'Welche sind Primzahlen?', 2],
    ])
    expect(cards[0].noteId).toBe(noteId)
    // Leere Antworten werden entfernt
    expect(cards[2].options).toEqual([
      { text: '1', correct: false },
      { text: '2', correct: true },
      { text: '3', correct: true },
    ])

    const bad = [
      { type: 'basic', front: 'Ohne Antwort', back: ' ' },
      { type: 'mc', front: 'Nur eine', options: [{ text: 'a', correct: true }] },
      { type: 'mc', front: 'Keine richtig', options: [{ text: 'a', correct: false }, { text: 'b', correct: false }] },
      { type: 'basic', front: '', back: 'x' },
    ]
    for (const c of bad) expect((await addCards(d.id, [c])).status).toBe(400)
    // Alles oder nichts
    expect((await addCards(d.id, [{ type: 'basic', front: 'ok', back: 'ok' }, bad[0]])).status).toBe(400)
    expect((await data()).cards.filter((c) => c.deckId === d.id)).toHaveLength(3)
  })

  it('ändert, verschiebt und löscht Karten', async () => {
    const a = await newDeck('Stapel A')
    const b = await newDeck('Stapel B')
    const [c] = (await addCards(a.id, [{ type: 'reversed', front: 'Frage', back: 'Antwort' }])).data.cards as Card[]
    const now = Date.now()
    await call(reviews.POST, '/api/reviews', {
      cookie: token,
      body: {
        reviews: [
          { cardId: c.id, side: 0, ...schedule(null, 3, now) },
          { cardId: c.id, side: 1, ...schedule(null, 3, now) },
        ],
      },
    })
    const r = await call(card.PATCH, '/', {
      method: 'PATCH',
      cookie: token,
      params: { id: c.id },
      body: { type: 'basic', back: 'Neue Antwort', deckId: b.id },
    })
    expect(r.status).toBe(200)
    expect(r.data.card).toMatchObject({ deckId: b.id, type: 'basic', front: 'Frage', back: 'Neue Antwort', position: 0 })
    // Lernstand der weggefallenen Rückseite wird verworfen
    expect((await data()).reviews.filter((x) => x.cardId === c.id).map((x) => x.side)).toEqual([0])

    const del = await call(card.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: c.id } })
    expect(del.status).toBe(200)
    expect((await data()).reviews.filter((x) => x.cardId === c.id)).toEqual([])
    expect((await call(card.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: c.id } })).status).toBe(404)
  })
})

describe('Lernstand', () => {
  it('übernimmt nur neuere Bewertungen und ignoriert unbekannte Karten', async () => {
    const d = await newDeck('Lernen')
    const [c, rev] = (
      await addCards(d.id, [
        { type: 'basic', front: 'A', back: 'B' },
        { type: 'basic', front: 'C', back: 'D' },
      ])
    ).data.cards as Card[]
    const t = Date.now()
    const first = { cardId: c.id, side: 0 as const, ...schedule(null, 3, t) }
    const second = { cardId: c.id, side: 0 as const, ...schedule(first, 3, t + 600_000) }
    const save = (list: CardReview[]) => call(reviews.POST, '/api/reviews', { cookie: token, body: { reviews: list } })

    expect((await save([second])).data.saved).toBe(1)
    // Älterer Stand (z. B. von einem Gerät, das offline war) überschreibt nichts
    expect((await save([first])).data.saved).toBe(0)
    const stored = (await data()).reviews.find((r) => r.cardId === c.id)!
    expect(stored).toMatchObject({ phase: 'review', interval: 1, reps: 2, reviewedAt: t + 600_000 })

    const unknown = { ...first, cardId: crypto.randomUUID() }
    const wrongSide = { ...first, cardId: rev.id, side: 1 as const }
    expect((await save([unknown, wrongSide])).data.saved).toBe(0)
    expect((await save([{ ...first, ease: 99 }])).status).toBe(400)

    const reset = await call(progress.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: d.id } })
    expect(reset.data.reset).toBe(1)
    expect((await data()).reviews.find((r) => r.cardId === c.id)).toBeUndefined()
  })

  it('löscht beim Löschen eines Stapels Karten und Lernstand', async () => {
    const d = await newDeck('Wegwerfen')
    const [c] = (await addCards(d.id, [{ type: 'basic', front: 'A', back: 'B' }])).data.cards as Card[]
    await call(reviews.POST, '/api/reviews', { cookie: token, body: { reviews: [{ cardId: c.id, side: 0, ...schedule(null, 4, Date.now()) }] } })
    const r = await call(deck.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: d.id } })
    expect(r.data.deletedCards).toBe(1)
    const after = await data()
    expect(after.decks.find((x) => x.id === d.id)).toBeUndefined()
    expect(after.cards.find((x) => x.id === c.id)).toBeUndefined()
    expect(after.reviews.find((x) => x.cardId === c.id)).toBeUndefined()
  })
})

describe('Trennung der Konten und Export', () => {
  it('andere Benutzer sehen und ändern fremde Stapel nicht', async () => {
    const d = await newDeck('Privat')
    const [c] = (await addCards(d.id, [{ type: 'basic', front: 'geheim', back: 'x' }])).data.cards as Card[]
    const created = await call(users.POST, '/api/admin/users', {
      cookie: token,
      body: { username: 'tom', password: 'Tom-Passwort-1234' },
    })
    expect(created.status).toBe(201)
    const tom = await loginAs('tom', 'Tom-Passwort-1234')
    await call(password.POST, '/', { cookie: tom, body: { currentPassword: 'Tom-Passwort-1234', newPassword: 'Tom-Passwort-5678' } })
    const theirs = await data(tom)
    expect(theirs).toEqual({ decks: [], cards: [], reviews: [] })
    expect((await addCards(d.id, [{ type: 'basic', front: 'x', back: 'y' }], tom)).status).toBe(404)
    expect((await call(card.PATCH, '/', { method: 'PATCH', cookie: tom, params: { id: c.id }, body: { front: 'x' } })).status).toBe(404)
    expect((await call(deck.DELETE, '/', { method: 'DELETE', cookie: tom, params: { id: d.id } })).status).toBe(404)
    const rv = await call(reviews.POST, '/api/reviews', { cookie: tom, body: { reviews: [{ cardId: c.id, side: 0, ...schedule(null, 3, Date.now()) }] } })
    expect(rv.data.saved).toBe(0)
  })

  it('exportiert Stapel als Markdown für Obsidian', async () => {
    const d = await newDeck('Export: Test')
    await addCards(d.id, [
      { type: 'basic', front: 'Frage', back: 'Antwort' },
      { type: 'mc', front: 'MC', options: [{ text: 'ja', correct: true }, { text: 'nein', correct: false }] },
    ])
    const r = await call(exportRoute.GET, '/api/export', { cookie: token })
    expect(r.status).toBe(200)
    const files = unzipSync(new Uint8Array(await r.res.arrayBuffer()))
    const md = strFromU8(files['Karteikarten/Export- Test.md'])
    expect(md).toBe('---\ntags:\n  - flashcards/Export-Test\n---\n\nFrage::Antwort\n\nMC\n?\n- [x] ja\n- [ ] nein\n')
  })
})
