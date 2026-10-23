import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { ADMIN_PASSWORD, call, loginAs, setupTestEnv } from '@/tests/helpers'
import * as flashcards from '@/app/api/flashcards/route'
import * as decks from '@/app/api/decks/route'
import * as deck from '@/app/api/decks/[id]/route'
import * as deckCards from '@/app/api/decks/[id]/cards/route'
import * as progress from '@/app/api/decks/[id]/progress/route'
import * as card from '@/app/api/cards/[id]/route'
import * as cardProgress from '@/app/api/cards/[id]/progress/route'
import * as reviews from '@/app/api/reviews/route'
import * as exportRoute from '@/app/api/export/route'
import * as stats from '@/app/api/stats/route'
import * as statsExport from '@/app/api/stats/export/route'
import * as users from '@/app/api/admin/users/route'
import * as password from '@/app/api/account/password/route'
import * as deckExport from '@/app/api/decks/[id]/export/route'
import * as deckImport from '@/app/api/decks/import/route'
import * as attachments from '@/app/api/attachments/route'
import * as files from '@/app/api/files/[...name]/route'
import { MAX_CARD_TEXT } from './limits'
import { schedule } from './srs'
import type { Card, CardReview, Deck, DeckImportResult, FlashcardData, ReviewLogEntry, StudyStats } from './types'

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

  it('speichert „Antwort eintippen“ je Stapel', async () => {
    const d = await newDeck('Französisch')
    expect(d.typeAnswer).toBe(false)
    const on = await call(deck.PATCH, '/', { method: 'PATCH', cookie: token, params: { id: d.id }, body: { typeAnswer: true } })
    expect(on.data.deck).toMatchObject({ name: 'Französisch', typeAnswer: true })
    const rename = await call(deck.PATCH, '/', { method: 'PATCH', cookie: token, params: { id: d.id }, body: { name: 'Französisch B1' } })
    expect(rename.data.deck.typeAnswer).toBe(true)
    expect((await newDeck('Spanisch', { typeAnswer: true })).typeAnswer).toBe(true)
    const bad = await call(deck.PATCH, '/', { method: 'PATCH', cookie: token, params: { id: d.id }, body: { typeAnswer: 'ja' } })
    expect(bad.status).toBe(400)
  })

  it('speichert den Wiederholungsplan je Stapel und den FSRS-Lernstand je Kartenseite', async () => {
    const d = await newDeck('FSRS', { scheduler: 'fsrs', retention: 0.85 })
    expect(d).toMatchObject({ scheduler: 'fsrs', retention: 0.85 })
    expect((await newDeck('Standard')).scheduler).toBe('sm2')
    const bad = await call(deck.PATCH, '/', { method: 'PATCH', cookie: token, params: { id: d.id }, body: { retention: 0.5 } })
    expect(bad.status).toBe(400)

    const [c, old] = (
      await addCards(d.id, [
        { type: 'basic', front: 'A', back: 'B' },
        { type: 'basic', front: 'C', back: 'D' },
      ])
    ).data.cards as Card[]
    const plan = { kind: 'fsrs', retention: 0.85 } as const
    const t = Date.now()
    const withMemory = { cardId: c.id, side: 0, ...schedule(null, 4, t, plan) }
    expect(withMemory.stability).toBeGreaterThan(0)
    // Ältere Geräte schicken keine Stabilität mit
    const withoutMemory = { cardId: old.id, side: 0, ...schedule(null, 4, t) }
    const r = await call(reviews.POST, '/api/reviews', { cookie: token, body: { reviews: [withMemory, withoutMemory] } })
    expect(r.data.saved).toBe(2)
    const stored = (await data()).reviews
    expect(stored.find((x) => x.cardId === c.id)).toMatchObject({ stability: withMemory.stability, difficulty: withMemory.difficulty })
    expect(stored.find((x) => x.cardId === old.id)).not.toHaveProperty('stability')
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

describe('Lückentext-Karten', () => {
  it('speichert Lücken als ==…==, prüft sie und führt den Lernstand je Lücke', async () => {
    const d = await newDeck('Lückentexte')
    const r = await addCards(d.id, [{ type: 'cloze', front: 'Die Ableitung von {{sin}} ist {{cos}} – {{date}} bleibt', back: '' }])
    expect(r.status).toBe(201)
    const [c] = r.data.cards as Card[]
    expect(c).toMatchObject({ type: 'cloze', front: 'Die Ableitung von ==sin== ist ==cos== – {{date}} bleibt', back: '' })
    expect((await addCards(d.id, [{ type: 'cloze', front: 'Ohne Lücke' }])).status).toBe(400)

    const now = Date.now()
    const save = (side: number, at = now) =>
      call(reviews.POST, '/api/reviews', { cookie: token, body: { reviews: [{ cardId: c.id, side, ...schedule(null, 3, at) }] } })
    expect((await save(0)).data.saved).toBe(1)
    expect((await save(1)).data.saved).toBe(1)
    // Eine dritte Lücke gibt es nicht
    expect((await save(2)).data.saved).toBe(0)
    // Ungültige Seite: verworfen, ohne die Anfrage abzulehnen
    expect((await save(50)).data).toEqual({ saved: 0, logged: 0, rejected: 1 })

    // Eine Lücke fällt weg: ihr Lernstand auch
    const edited = await call(card.PATCH, '/', { method: 'PATCH', cookie: token, params: { id: c.id }, body: { front: 'Nur noch ==sin==' } })
    expect(edited.status).toBe(200)
    expect((await data()).reviews.filter((x) => x.cardId === c.id).map((x) => x.side)).toEqual([0])
  })
})

describe('Bildverdeckung', () => {
  it('speichert Bild und Flächen, prüft sie und führt den Lernstand je Fläche', async () => {
    const d = await newDeck('Anatomie')
    const occlusion = {
      image: 'herz.png',
      masks: [
        { x: 0.1, y: 0.1, w: 0.2, h: 0.1, label: '  Aorta ' },
        { x: 0.5, y: 0.5, w: 0.2, h: 0.1, label: '' },
        { x: 0.9, y: 0.9, w: 0.3, h: 0.3, label: '' },
      ],
      hideAll: true,
    }
    const r = await addCards(d.id, [{ type: 'occlusion', front: 'Herz', back: '', occlusion }])
    expect(r.status).toBe(201)
    const [c] = r.data.cards as Card[]
    expect(c).toMatchObject({ type: 'occlusion', front: 'Herz', options: [] })
    // Beschriftung bereinigt, Fläche ins Bild eingepasst, jede mit eigener Kennung
    expect(c.occlusion).toEqual({
      image: 'herz.png',
      masks: [
        { id: expect.any(String), x: 0.1, y: 0.1, w: 0.2, h: 0.1, label: 'Aorta' },
        { id: expect.any(String), x: 0.5, y: 0.5, w: 0.2, h: 0.1, label: '' },
        { id: expect.any(String), x: 0.7, y: 0.7, w: 0.3, h: 0.3, label: '' },
      ],
      hideAll: true,
    })
    expect(new Set(c.occlusion!.masks.map((m) => m.id)).size).toBe(3)
    expect((await addCards(d.id, [{ type: 'occlusion', front: 'Herz', occlusion: { ...occlusion, masks: [] } }])).status).toBe(400)
    expect((await addCards(d.id, [{ type: 'occlusion', front: 'Herz', occlusion: { ...occlusion, image: 'skript.pdf' } }])).status).toBe(400)
    expect((await addCards(d.id, [{ type: 'occlusion', front: 'Herz' }])).status).toBe(400)
    const outside = { ...occlusion, masks: [{ x: 1.5, y: 0, w: 0.1, h: 0.1, label: '' }] }
    expect((await addCards(d.id, [{ type: 'occlusion', front: 'Herz', occlusion: outside }])).status).toBe(400)
    // Andere Kartenarten speichern keine Flächen
    const [plain] = (await addCards(d.id, [{ type: 'basic', front: 'a', back: 'b', occlusion }])).data.cards as Card[]
    expect(plain.occlusion).toBeNull()

    const now = Date.now()
    const save = (side: number) =>
      call(reviews.POST, '/api/reviews', { cookie: token, body: { reviews: [{ cardId: c.id, side, ...schedule(null, 3, now) }] } })
    expect((await save(0)).data.saved).toBe(1)
    expect((await save(2)).data.saved).toBe(1)
    expect((await save(3)).data.saved).toBe(0)

    // Eine Fläche fällt weg: der Lernstand der letzten Seite auch
    const edited = await call(card.PATCH, '/', {
      method: 'PATCH',
      cookie: token,
      params: { id: c.id },
      body: { occlusion: { ...occlusion, masks: occlusion.masks.slice(0, 2) } },
    })
    expect(edited.status).toBe(200)
    expect(edited.data.card.occlusion.masks).toHaveLength(2)
    expect((await data()).reviews.filter((x) => x.cardId === c.id).map((x) => x.side)).toEqual([0])
  })
})

describe('Lernstand beim Bearbeiten von Lücken und Flächen', () => {
  const at = Date.UTC(2026, 8, 1, 8)
  const minute = 60_000
  const patchCard = (id: string, body: object) => call(card.PATCH, '/', { method: 'PATCH', cookie: token, params: { id }, body })
  /** Kartenseite → wievielte Minute nach `at` sie zuletzt bewertet wurde */
  async function progress(cardId: string) {
    const list = (await data()).reviews.filter((r) => r.cardId === cardId)
    return Object.fromEntries(list.map((r) => [r.side, (r.reviewedAt - at) / minute]))
  }
  async function review(cardId: string, sides: number[]) {
    const body = {
      reviews: sides.map((side) => ({ cardId, side, ...schedule(null, 3, at + side * minute) })),
      log: sides.map((side) => ({
        cardId,
        side,
        rating: 3,
        phase: 'new',
        intervalBefore: 0,
        intervalAfter: 1,
        durationMs: 1000,
        reviewedAt: at + side * minute,
      })),
    }
    expect((await call(reviews.POST, '/api/reviews', { cookie: token, body })).data.saved).toBe(sides.length)
  }

  it('Bildverdeckung: Der Lernstand folgt der Fläche, nicht ihrer Position', async () => {
    const d = await newDeck('Flächen umsortieren')
    const masks = ['Aorta', 'Vene', 'Kammer'].map((label, i) => ({ x: 0.1 + i * 0.3, y: 0.1, w: 0.2, h: 0.1, label }))
    const [c] = (await addCards(d.id, [{ type: 'occlusion', front: 'Herz', occlusion: { image: 'herz.png', masks, hideAll: false } }]))
      .data.cards as Card[]
    const ids = c.occlusion!.masks.map((m) => m.id)
    expect(new Set(ids).size).toBe(3)
    await review(c.id, [0, 1, 2])

    // Die erste Fläche fällt weg: Die anderen behalten ihren eigenen Lernstand
    const [, vene, kammer] = c.occlusion!.masks
    const removed = await patchCard(c.id, { occlusion: { ...c.occlusion, masks: [vene, kammer] } })
    expect(removed.status).toBe(200)
    expect(removed.data.sideMap).toEqual([1, 2])
    expect(await progress(c.id)).toEqual({ 0: 1, 1: 2 })

    // Umstellen, Verschieben und Beschriften ändern nichts; eine neue Fläche vorne ist neu
    const moved = { ...kammer, x: 0.5, y: 0.6, label: 'Linke Kammer' }
    const reordered = await patchCard(c.id, {
      occlusion: { ...c.occlusion, masks: [{ x: 0.3, y: 0.3, w: 0.1, h: 0.1, label: 'Neu' }, moved, vene] },
    })
    expect(reordered.data.sideMap).toEqual([null, 1, 0])
    expect(await progress(c.id)).toEqual({ 1: 2, 2: 1 })
    expect((reordered.data.card as Card).occlusion!.masks.map((m) => m.id).slice(1)).toEqual([kammer.id, vene.id])

    // Auch das Protokoll zieht mit – die weggefallene Fläche zählt für keine Seite mehr
    const csv = new TextDecoder().decode(await (await call(statsExport.GET, '/', { cookie: token })).res.arrayBuffer())
    const line = (n: number) => csv.split('\r\n').find((l) => l.startsWith(new Date(at + n * minute).toISOString()))
    expect(line(0)).toContain(';Flächen umsortieren;(gelöscht);')
    expect(line(1)).toContain(';Herz;Fläche 3;')
    expect(line(2)).toContain(';Herz;Fläche 2;')
  })

  it('Bildverdeckung aus einem älteren Stand der App (ohne Kennungen): wie bisher über die Position', async () => {
    const d = await newDeck('Flächen ohne Kennung')
    const masks = [0.1, 0.4, 0.7].map((x) => ({ x, y: 0.1, w: 0.2, h: 0.1, label: '' }))
    const occlusion = { image: 'herz.png', masks, hideAll: false }
    const [c] = (await addCards(d.id, [{ type: 'occlusion', front: 'Herz', occlusion }])).data.cards as Card[]
    await review(c.id, [0, 1, 2])
    const edited = await patchCard(c.id, { occlusion: { ...occlusion, masks: masks.slice(0, 2) } })
    expect(edited.data.sideMap).toEqual([0, 1])
    expect((edited.data.card as Card).occlusion!.masks.map((m) => m.id)).toEqual(c.occlusion!.masks.slice(0, 2).map((m) => m.id))
    expect(await progress(c.id)).toEqual({ 0: 0, 1: 1 })
  })

  it('Lückentext: Der Lernstand folgt dem Text der Lücke', async () => {
    const d = await newDeck('Lücken umsortieren')
    const [c] = (await addCards(d.id, [{ type: 'cloze', front: 'Die Ableitung von ==sin== ist ==cos==.' }])).data.cards as Card[]
    await review(c.id, [0, 1])

    // Vorne kommt eine Lücke dazu: Sie ist neu, die anderen behalten ihren Stand
    const added = await patchCard(c.id, { front: 'Die ==Ableitung== von ==sin== ist ==cos==.' })
    expect(added.data.sideMap).toEqual([null, 0, 1])
    expect(await progress(c.id)).toEqual({ 1: 0, 2: 1 })

    // Eine umformulierte Lücke behält ihren Stand
    const edited = await patchCard(c.id, { front: 'Die ==Ableitung== von ==sin(x)== ist ==cos==.' })
    expect(edited.data.sideMap).toEqual([0, 1, 2])
    expect(await progress(c.id)).toEqual({ 1: 0, 2: 1 })

    // Wird eine Lücke in der Mitte gelöscht, verliert nur sie ihren Stand
    const removed = await patchCard(c.id, { front: 'Die ==Ableitung== von sin(x) ist ==cos==.' })
    expect(removed.data.sideMap).toEqual([0, 2])
    expect(await progress(c.id)).toEqual({ 1: 1 })

    // Wechsel der Kartenart: wie bisher nach Position
    const basic = await patchCard(c.id, { type: 'reversed', front: 'Ableitung von sin', back: 'cos' })
    expect(basic.data.sideMap).toEqual([0, 1])
    expect(await progress(c.id)).toEqual({ 1: 1 })
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
    // Ein ungültiger Eintrag wird einzeln verworfen – die übrigen derselben Anfrage kommen an
    const third = { cardId: c.id, side: 0 as const, ...schedule(second, 3, t + 1_200_000) }
    const mixed = await save([{ ...first, ease: 99, reviewedAt: t + 1_800_000 }, third])
    expect(mixed.data).toEqual({ saved: 1, logged: 0, rejected: 1 })
    expect((await data()).reviews.find((r) => r.cardId === c.id)).toMatchObject({ reviewedAt: t + 1_200_000 })

    const reset = await call(progress.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: d.id } })
    expect(reset.data.reset).toBe(1)
    expect((await data()).reviews.find((r) => r.cardId === c.id)).toBeUndefined()
  })

  it('setzt Karten aus und lernt einzelne Karten neu', async () => {
    const d = await newDeck('Problemkarten')
    const [c, other] = (
      await addCards(d.id, [
        { type: 'basic', front: 'Schwer', back: 'Lang und unklar' },
        { type: 'basic', front: 'Leicht', back: 'Kurz' },
      ])
    ).data.cards as Card[]
    expect(c.suspended).toBe(false)
    const now = Date.now()
    await call(reviews.POST, '/api/reviews', {
      cookie: token,
      body: {
        reviews: [
          { cardId: c.id, side: 0, ...schedule(null, 3, now), lapses: 6 },
          { cardId: other.id, side: 0, ...schedule(null, 3, now) },
        ],
      },
    })
    const off = await call(card.PATCH, '/', { method: 'PATCH', cookie: token, params: { id: c.id }, body: { suspended: true } })
    expect(off.data.card).toMatchObject({ suspended: true, front: 'Schwer' })
    // Bearbeiten lässt das Aussetzen stehen
    const edited = await call(card.PATCH, '/', { method: 'PATCH', cookie: token, params: { id: c.id }, body: { back: 'Kurz und klar' } })
    expect(edited.data.card).toMatchObject({ suspended: true, back: 'Kurz und klar' })

    const reset = await call(cardProgress.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: c.id } })
    expect(reset.status).toBe(200)
    expect(reset.data.card).toMatchObject({ id: c.id, suspended: false })
    const after = await data()
    expect(after.reviews.find((r) => r.cardId === c.id)).toBeUndefined()
    expect(after.reviews.find((r) => r.cardId === other.id)).toBeDefined()
    expect((await call(cardProgress.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: crypto.randomUUID() } })).status).toBe(404)
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

describe('Bewertungsprotokoll und Statistik', () => {
  it('protokolliert jede Bewertung einmal und wertet sie nach Tagen in der Zeitzone des Geräts aus', async () => {
    const d = await newDeck('Statistik')
    const [c, formula] = (
      await addCards(d.id, [
        { type: 'basic', front: 'Frage', back: 'B' },
        { type: 'basic', front: '=SUMME(A1)', back: 'B' },
      ])
    ).data.cards as Card[]
    // 22:30 UTC ist in Berlin schon der nächste Tag
    const t = Date.UTC(2026, 9, 13, 22, 30)
    const entry = (at: number, rating: 1 | 3, phase: ReviewLogEntry['phase']): ReviewLogEntry => ({
      cardId: c.id,
      side: 0,
      rating,
      phase,
      intervalBefore: 1,
      intervalAfter: 2.5,
      durationMs: 3000,
      reviewedAt: at,
    })
    const log = [entry(t, 3, 'new'), entry(t + 600_000, 1, 'review'), entry(t + 1_200_000, 3, 'review')]
    const send = (body: object) => call(reviews.POST, '/api/reviews', { cookie: token, body })
    const first = await send({ reviews: [{ cardId: c.id, side: 0, ...schedule(null, 3, t + 1_200_000) }], log })
    expect(first.data).toEqual({ saved: 1, logged: 3, rejected: 0 })
    // Erneut gesendet (z. B. Antwort ging verloren) und Einträge fremder Karten: nichts doppelt
    const again = await send({ reviews: [], log: [...log, { ...log[0], cardId: crypto.randomUUID() }] })
    expect(again.data).toEqual({ saved: 0, logged: 0, rejected: 0 })
    expect((await send({ reviews: [], log: [{ ...log[0], rating: 5 }] })).data).toEqual({ saved: 0, logged: 0, rejected: 1 })
    // Ältere Geräte senden noch kein Protokoll
    expect((await send({ reviews: [] })).status).toBe(200)

    const berlin = (await call(stats.GET, '/', { cookie: token, query: { tz: 'Europe/Berlin' } })).data as StudyStats
    expect(berlin.days.find((x) => x.date === '2026-10-14')).toEqual({ date: '2026-10-14', reviews: 3, again: 1, ms: 9000 })
    const utc = (await call(stats.GET, '/', { cookie: token, query: { tz: 'UTC' } })).data as StudyStats
    expect(utc.days.find((x) => x.date === '2026-10-13')?.reviews).toBe(3)
    expect(berlin.total).toBeGreaterThanOrEqual(3)
    expect((await call(stats.GET, '/', { cookie: token, query: { tz: 'Mars/Olympus' } })).status).toBe(400)

    // Das Protokoll bleibt, auch wenn die Karte gelöscht wird
    await call(card.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: c.id } })
    const { res } = await call(statsExport.GET, '/', { cookie: token })
    expect(res.headers.get('content-type')).toContain('text/csv')
    const bytes = new Uint8Array(await res.arrayBuffer())
    // BOM, damit Excel die Umlaute erkennt
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const csv = new TextDecoder().decode(bytes)
    expect(csv.startsWith('Zeitpunkt;Stapel;Karte;')).toBe(true)
    expect(csv).toContain('2026-10-13T22:30:00.000Z;Statistik;(gelöscht);Vorderseite;Gut;neu;1;2,5;3\r\n')
    // Formeln am Anfang eines Feldes werden in Tabellenprogrammen nicht ausgeführt
    await send({ reviews: [], log: [{ ...log[0], cardId: formula.id }] })
    const again2 = new TextDecoder().decode(await (await call(statsExport.GET, '/', { cookie: token })).res.arrayBuffer())
    expect(again2).toContain(";'=SUMME(A1);")
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
    expect(theirs).toEqual({ decks: [], cards: [], reviews: [], fsrs: null })
    expect((await addCards(d.id, [{ type: 'basic', front: 'x', back: 'y' }], tom)).status).toBe(404)
    expect((await call(card.PATCH, '/', { method: 'PATCH', cookie: tom, params: { id: c.id }, body: { front: 'x' } })).status).toBe(404)
    expect((await call(deck.DELETE, '/', { method: 'DELETE', cookie: tom, params: { id: d.id } })).status).toBe(404)
    expect((await call(card.PATCH, '/', { method: 'PATCH', cookie: tom, params: { id: c.id }, body: { suspended: true } })).status).toBe(404)
    expect((await call(cardProgress.DELETE, '/', { method: 'DELETE', cookie: tom, params: { id: c.id } })).status).toBe(404)
    const rv = await call(reviews.POST, '/api/reviews', { cookie: tom, body: { reviews: [{ cardId: c.id, side: 0, ...schedule(null, 3, Date.now()) }] } })
    expect(rv.data.saved).toBe(0)
  })

  it('exportiert Stapel als Markdown', async () => {
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

describe('Stapel als Datei', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
  let other = ''
  let exported: Uint8Array

  async function upload(name: string, bytes: Uint8Array, cookie = token) {
    const form = new FormData()
    form.append('file', new File([new Uint8Array(bytes)], name))
    const r = await call(attachments.POST, '/', { cookie, form })
    expect(r.status).toBe(201)
    return r.data.attachment as { filename: string }
  }

  async function importPackage(bytes: Uint8Array, cookie: string, deckId?: string) {
    const form = new FormData()
    form.append('file', new File([new Uint8Array(bytes)], 'Kardiologie.noted-deck.zip'))
    if (deckId) form.append('deckId', deckId)
    return call(deckImport.POST, '/', { cookie, form })
  }

  // Die Kennungen der Flächen gelten nur im eigenen Konto – der Import vergibt neue
  const comparable = (c: Card) => ({
    type: c.type,
    front: c.front,
    back: c.back,
    options: c.options,
    occlusion: c.occlusion && { ...c.occlusion, masks: c.occlusion.masks.map(({ x, y, w, h, label }) => ({ x, y, w, h, label })) },
    suspended: c.suspended,
  })

  it('überträgt einen Stapel samt Bildern und Einstellungen verlustfrei in ein anderes Konto', async () => {
    await upload('Herz Skizze.png', png)
    const settings = { description: 'Herz', newPerDay: 7, typeAnswer: true, scheduler: 'fsrs', retention: 0.8 } as const
    const d = await newDeck('Kardiologie', settings)
    const occlusion = {
      image: 'Herz Skizze.png',
      masks: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.1, label: 'Aorta' }],
      hideAll: false,
    }
    const created = await addCards(d.id, [
      { type: 'basic', front: 'Was ist das? ![[Herz Skizze.png|200]]', back: 'Das Herz' },
      { type: 'reversed', front: 'Aorta', back: 'Hauptschlagader' },
      { type: 'mc', front: 'Kammern?', back: 'Erklärung', options: [{ text: 'vier', correct: true }, { text: 'zwei', correct: false }] },
      { type: 'cloze', front: 'Das Herz hat {{vier}} Kammern.', back: '' },
      { type: 'occlusion', front: 'Herz beschriften', occlusion },
    ])
    expect(created.status).toBe(201)
    const original = created.data.cards as Card[]
    await call(card.PATCH, '/', { method: 'PATCH', cookie: token, params: { id: original[1].id }, body: { suspended: true } })

    const r = await call(deckExport.GET, '/', { cookie: token, params: { id: d.id } })
    expect(r.status).toBe(200)
    expect(r.res.headers.get('content-type')).toBe('application/zip')
    expect(r.res.headers.get('content-disposition')).toContain('Kardiologie.noted-deck.zip')
    exported = new Uint8Array(await r.res.arrayBuffer())
    expect(Object.keys(unzipSync(exported)).sort()).toEqual(['deck.json', 'media/Herz Skizze.png'])
    const manifest = JSON.parse(strFromU8(unzipSync(exported)['deck.json']))
    expect(manifest.cards[4].occlusion.masks).toEqual([{ x: 0.1, y: 0.2, w: 0.3, h: 0.1, label: 'Aorta' }])

    // Zweites Konto, in dem es schon eine andere Datei mit demselben Namen gibt
    await call(users.POST, '/api/admin/users', { cookie: token, body: { username: 'stapelgast', password: 'Stapel-Kennwort-1' } })
    other = await loginAs('stapelgast', 'Stapel-Kennwort-1')
    await call(password.POST, '/', { cookie: other, body: { currentPassword: 'Stapel-Kennwort-1', newPassword: 'Stapel-Kennwort-2' } })
    await upload('Herz Skizze.png', new Uint8Array([1, 2]), other)

    const imported = await importPackage(exported, other)
    expect(imported.status).toBe(200)
    const result = imported.data as DeckImportResult
    expect(result).toMatchObject({ deck: { name: 'Kardiologie', created: true }, cards: 5, media: 1, duplicates: 0, skipped: [] })

    const theirs = await data(other)
    expect(theirs.decks).toHaveLength(1)
    expect(theirs.decks[0]).toMatchObject({ name: 'Kardiologie', ...settings })
    const copies = theirs.cards.filter((c) => c.deckId === result.deck.id)
    const mine = (await data()).cards.filter((c) => c.deckId === d.id)
    // Die neue Datei heißt anders – die Verweise folgen ihr
    const rename = (c: ReturnType<typeof comparable>) =>
      JSON.parse(JSON.stringify(c).replaceAll('Herz Skizze.png', 'Herz Skizze 1.png')) as ReturnType<typeof comparable>
    expect(copies.map(comparable)).toEqual(mine.map(comparable).map(rename))
    expect(copies.map((c) => c.noteId)).toEqual([null, null, null, null, null])
    expect(theirs.reviews).toEqual([])
    const image = await call(files.GET, '/', { cookie: other, params: { name: ['Herz Skizze 1.png'] } })
    expect(new Uint8Array(await image.res.arrayBuffer())).toEqual(png)
  })

  it('legt beim erneuten Import in denselben Stapel keine Karte doppelt an', async () => {
    const target = (await data(other)).decks[0]
    const again = await importPackage(exported, other, target.id)
    expect(again.data).toMatchObject({ deck: { id: target.id, created: false }, cards: 0, media: 0, duplicates: 5 })
    expect((await data(other)).cards.filter((c) => c.deckId === target.id)).toHaveLength(5)
    // Ohne Zielstapel entsteht ein neuer mit freiem Namen
    const copy = await importPackage(exported, other)
    expect(copy.data).toMatchObject({ deck: { name: 'Kardiologie 1', created: true }, cards: 5, media: 0 })
  })

  it('überspringt ungültige Karten und zu große Dateien, lehnt fremde Dateien und Stapel ab', async () => {
    const manifest = {
      noted: 1,
      deck: { name: 'Manipuliert' },
      cards: [
        { type: 'basic', front: 'x'.repeat(MAX_CARD_TEXT + 1), back: 'zu lang' },
        { type: 'geheim', front: 'Unbekannt' },
        { type: 'basic', front: 'Gültig', back: 'Ja' },
      ],
      media: ['riesig.png'],
    }
    process.env.MAX_UPLOAD_MB = '1'
    try {
      const bytes = zipSync({
        'deck.json': strToU8(JSON.stringify(manifest)),
        'media/riesig.png': new Uint8Array(2 * 1024 * 1024),
      })
      const r = await importPackage(bytes, token)
      expect(r.status).toBe(200)
      expect(r.data.cards).toBe(1)
      expect(r.data.skipped).toEqual([
        'Karte 2 (unbekannte Kartenart)',
        'riesig.png (zu groß)',
        expect.stringMatching(/^„x+“ \(Eine Kartenseite darf höchstens 20\.000 Zeichen lang sein\.\)$/),
      ])
    } finally {
      delete process.env.MAX_UPLOAD_MB
    }

    const notAPackage = await importPackage(zipSync({ 'notiz.md': strToU8('# Hallo') }), token)
    expect(notAPackage.status).toBe(400)
    expect(notAPackage.data.message).toMatch(/deck\.json fehlt/)
    const mine = (await data()).decks.find((x) => x.name === 'Kardiologie')!
    expect((await importPackage(exported, other, mine.id)).status).toBe(404)
    expect((await call(deckExport.GET, '/', { cookie: other, params: { id: mine.id } })).status).toBe(404)
  })
})
