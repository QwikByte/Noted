import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import zlib from 'node:zlib'
import Database from 'better-sqlite3'
import { strToU8, zipSync } from 'fflate'
import { ADMIN_PASSWORD, call, loginAs, setupTestEnv } from '@/tests/helpers'
import * as anki from '@/app/api/flashcards/anki/route'
import * as flashcards from '@/app/api/flashcards/route'
import * as attachments from '@/app/api/attachments/route'
import * as stats from '@/app/api/stats/route'
import type { FlashcardData, StudyStats } from './types'

let env: Awaited<ReturnType<typeof setupTestEnv>>
let token = ''

beforeAll(async () => {
  env = await setupTestEnv()
  token = await loginAs('admin', ADMIN_PASSWORD)
})
afterAll(() => env.cleanup())

const CRT = 1_700_000_000
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])

/** Kleine Anki-Sammlung: beidseitige Karte mit Protokoll, ausgesetzte Grundkarte mit Bild, Lückentext, leere Karte */
function collection(deck: string, schema18: boolean): Buffer {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE col (id INTEGER PRIMARY KEY, crt INTEGER, decks TEXT);
    CREATE TABLE notes (id INTEGER PRIMARY KEY, flds TEXT);
    CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER, ord INTEGER, type INTEGER, queue INTEGER,
      due INTEGER, ivl INTEGER, factor INTEGER, reps INTEGER, lapses INTEGER);
    CREATE TABLE revlog (id INTEGER PRIMARY KEY, cid INTEGER, ease INTEGER, ivl INTEGER, lastIvl INTEGER, time INTEGER, type INTEGER);
  `)
  if (schema18) {
    db.exec('CREATE TABLE decks (id INTEGER PRIMARY KEY, name TEXT)')
    db.prepare('INSERT INTO decks VALUES (7, ?)').run(deck.replace('::', '\x1f'))
    db.prepare('INSERT INTO col VALUES (1, ?, ?)').run(CRT, '')
  } else {
    db.prepare('INSERT INTO col VALUES (1, ?, ?)').run(CRT, JSON.stringify({ 7: { id: 7, name: deck } }))
  }
  const note = db.prepare('INSERT INTO notes VALUES (?, ?)')
  const card = db.prepare('INSERT INTO cards VALUES (?, ?, 7, ?, ?, ?, ?, ?, ?, ?, ?)')
  note.run(1, 'Haus\x1fhouse')
  card.run(101, 1, 0, 2, 2, 100, 10, 2500, 5, 0)
  card.run(102, 1, 1, 0, 0, 0, 0, 0, 0, 0)
  note.run(2, '<b>Herz</b> <img src="herz.png">\x1fpumpt <i>Blut</i>')
  card.run(201, 2, 0, 2, -1, 50, 3, 2100, 3, 2)
  note.run(3, '{{c1::Paris}} liegt an der {{c2::Seine}}\x1fFrankreich')
  card.run(301, 3, 0, 2, 2, 60, 4, 2500, 2, 0)
  card.run(302, 3, 1, 0, 0, 0, 0, 0, 0, 0)
  note.run(4, 'Leer\x1f')
  card.run(401, 4, 0, 0, 0, 0, 0, 0, 0, 0)
  const rev = db.prepare('INSERT INTO revlog VALUES (?, ?, ?, ?, ?, ?, ?)')
  rev.run(1_760_000_000_000, 101, 3, -600, 0, 4000, 0)
  rev.run(1_760_086_400_000, 101, 4, 10, 1, 500_000, 1)
  const data = db.serialize()
  db.close()
  return data
}

/** Medienliste im neuen Format: Protobuf { repeated MediaEntry entries = 1 }, MediaEntry { string name = 1 } */
function mediaProto(name: string): Uint8Array {
  const bytes = strToU8(name)
  const entry = [0x0a, bytes.length, ...bytes, 0x10, PNG.length]
  return new Uint8Array([0x0a, entry.length, ...entry])
}

function legacyPackage(deck: string) {
  return zipSync({ 'collection.anki2': collection(deck, false), media: strToU8(JSON.stringify({ 0: 'herz.png' })), 0: PNG })
}

function newPackage(deck: string) {
  return zipSync({
    'collection.anki21b': zlib.zstdCompressSync(collection(deck, true)),
    // Ältere Sammlung, die nur zum Aktualisieren auffordert
    'collection.anki2': collection('Bitte aktualisieren', false),
    media: zlib.zstdCompressSync(mediaProto('herz.png')),
    0: zlib.zstdCompressSync(PNG),
  })
}

async function importPackage(data: Uint8Array, progress: boolean, name = 'deck.apkg') {
  const form = new FormData()
  form.append('file', new File([new Uint8Array(data)], name))
  if (progress) form.append('progress', '1')
  return call(anki.POST, '/', { cookie: token, form })
}

async function load() {
  return (await call(flashcards.GET, '/', { cookie: token })).data as FlashcardData
}

describe('Anki-Import', () => {
  it('übernimmt Stapel, Kartenarten, Bilder und – auf Wunsch – Lernstand und Protokoll', async () => {
    const r = await importPackage(legacyPackage('Uni::Biologie'), true)
    expect(r.status).toBe(200)
    expect(r.data).toMatchObject({ decks: 1, cards: 3, media: 1 })
    expect(r.data.skipped).toEqual(['„Leer“ (leere Seite)'])

    const data = await load()
    const deck = data.decks.find((d) => d.name === 'Uni – Biologie')!
    const cards = data.cards.filter((c) => c.deckId === deck.id)
    expect(cards.map((c) => [c.type, c.front, c.back, c.suspended])).toEqual([
      ['reversed', 'Haus', 'house', false],
      ['basic', '**Herz** ![[herz.png]]', 'pumpt *Blut*', true],
      ['cloze', '==Paris== liegt an der ==Seine==', 'Frankreich', false],
    ])
    const files = (await call(attachments.GET, '/', { cookie: token })).data.attachments as { filename: string; size: number }[]
    expect(files).toContainEqual(expect.objectContaining({ filename: 'herz.png', size: PNG.length }))

    const states = data.reviews.filter((x) => cards.some((c) => c.id === x.cardId))
    expect(states.map((x) => [cards.find((c) => c.id === x.cardId)!.front.slice(0, 4), x.side, x.phase, x.interval])).toEqual([
      ['Haus', 0, 'review', 10],
      ['**He', 0, 'review', 3],
      ['==Pa', 0, 'review', 4],
    ])
    expect(states[0]).toMatchObject({ due: (CRT + 100 * 86_400) * 1000, reviewedAt: 1_760_086_400_000, ease: 2.5, reps: 5 })
    const s = (await call(stats.GET, '/', { cookie: token, query: { tz: 'UTC' } })).data as StudyStats
    expect(s.total).toBe(2)

    // Zweiter Import derselben Datei: nichts doppelt, auch keine zweite Bilddatei
    const again = await importPackage(legacyPackage('Uni::Biologie'), true)
    expect(again.data).toMatchObject({ decks: 0, cards: 0, media: 0 })
    expect(again.data.skipped).toContain('3 Karten in „Uni – Biologie“ gab es schon')
    expect((await call(stats.GET, '/', { cookie: token, query: { tz: 'UTC' } })).data.total).toBe(2)
  })

  it('liest das neue Format (zstd) und lässt ohne Wunsch den Lernstand weg', async () => {
    const r = await importPackage(newPackage('Chemie::Organik'), false, 'Chemie.colpkg')
    expect(r.data).toMatchObject({ decks: 1, cards: 3 })
    const data = await load()
    const deck = data.decks.find((d) => d.name === 'Chemie – Organik')!
    const cards = data.cards.filter((c) => c.deckId === deck.id)
    expect(cards.map((c) => c.front)).toEqual(['Haus', '**Herz** ![[herz.png]]', '==Paris== liegt an der ==Seine=='])
    expect(cards.some((c) => c.suspended)).toBe(false)
    expect(data.reviews.filter((x) => cards.some((c) => c.id === x.cardId))).toEqual([])
    expect(data.decks.some((d) => d.name === 'Bitte aktualisieren')).toBe(false)
  })

  it('lehnt eine Sammlung ab, die entpackt größer als die Importgrenze wäre', async () => {
    process.env.MAX_IMPORT_MB = '1'
    try {
      const db = new Database(':memory:')
      db.exec('CREATE TABLE col (id INTEGER PRIMARY KEY, crt INTEGER, decks TEXT); CREATE TABLE notes (id INTEGER PRIMARY KEY, flds TEXT)')
      // 2 MB Text – mit zstd nur wenige KB, entpackt über der Grenze von 1 MB
      db.prepare('INSERT INTO notes VALUES (1, ?)').run('a'.repeat(2 * 1024 * 1024))
      const big = zipSync({ 'collection.anki21b': zlib.zstdCompressSync(db.serialize()) })
      db.close()
      const r = await importPackage(big, false, 'gross.apkg')
      expect(r.status).toBe(413)
      expect(r.data.error).toBe('too_large')
      expect(r.data.message).toContain('entpackt zu groß')
    } finally {
      delete process.env.MAX_IMPORT_MB
    }
  })

  it('lehnt Dateien ab, die kein Anki-Paket sind', async () => {
    expect((await importPackage(new Uint8Array([1, 2, 3]), false)).status).toBe(400)
    expect((await importPackage(zipSync({ 'notiz.md': strToU8('# Hallo') }), false)).status).toBe(400)
    const form = new FormData()
    expect((await call(anki.POST, '/', { cookie: token, form })).status).toBe(400)
  })
})
