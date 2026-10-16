import 'server-only'
import { z } from 'zod'
import { getDb } from './db'
import { ApiError, badRequest, conflict, notFound } from './http'
import { uuid } from './crypto'
import { isValidId } from './notes'
import { DEFAULT_NEW_PER_DAY } from '@/lib/shared/srs'
import type { Card, CardOption, CardReview, CardType, Deck, FlashcardData } from '@/lib/shared/types'

export const MAX_CARD_TEXT = 20_000
export const MAX_OPTIONS = 12
export const MAX_OPTION_TEXT = 2_000
const MAX_CARDS_PER_USER = 50_000
const MAX_DECK_NAME = 200

type DeckRow = {
  id: string
  user_id: number
  name: string
  description: string
  new_per_day: number
  created_at: number
  updated_at: number
}

type CardRow = {
  id: string
  user_id: number
  deck_id: string
  note_id: string | null
  type: CardType
  front: string
  back: string
  options: string
  position: number
  created_at: number
  updated_at: number
}

type ReviewRow = {
  card_id: string
  side: 0 | 1
  user_id: number
  phase: CardReview['phase']
  step: number
  interval: number
  ease: number
  reps: number
  lapses: number
  due: number
  reviewed_at: number
  introduced_at: number
}

const toDeck = (r: DeckRow): Deck => ({
  id: r.id,
  name: r.name,
  description: r.description,
  newPerDay: r.new_per_day,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

function parseOptions(raw: string): CardOption[] {
  try {
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

const toCard = (r: CardRow): Card => ({
  id: r.id,
  deckId: r.deck_id,
  noteId: r.note_id,
  type: r.type,
  front: r.front,
  back: r.back,
  options: parseOptions(r.options),
  position: r.position,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

const toReview = (r: ReviewRow): CardReview => ({
  cardId: r.card_id,
  side: r.side,
  phase: r.phase,
  step: r.step,
  interval: r.interval,
  ease: r.ease,
  reps: r.reps,
  lapses: r.lapses,
  due: r.due,
  reviewedAt: r.reviewed_at,
  introducedAt: r.introduced_at,
})

/** Alles auf einmal – der Browser berechnet daraus fällige Karten und Lernsitzungen (auch offline). */
export function getFlashcardData(userId: number): FlashcardData {
  const db = getDb()
  const decks = (db.prepare('SELECT * FROM decks WHERE user_id = ? ORDER BY name COLLATE NOCASE').all(userId) as DeckRow[]).map(toDeck)
  const cards = (
    db.prepare('SELECT * FROM cards WHERE user_id = ? ORDER BY deck_id, position, created_at').all(userId) as CardRow[]
  ).map(toCard)
  const reviews = (db.prepare('SELECT * FROM card_reviews WHERE user_id = ?').all(userId) as ReviewRow[]).map(toReview)
  return { decks, cards, reviews }
}

// ---------------------------------------------------------------------------
// Stapel
// ---------------------------------------------------------------------------

function getDeckRow(userId: number, id: string): DeckRow {
  const row = getDb().prepare('SELECT * FROM decks WHERE id = ? AND user_id = ?').get(id, userId) as DeckRow | undefined
  if (!row) throw notFound('Stapel nicht gefunden.')
  return row
}

function checkDeckName(userId: number, name: string, excludeId?: string): string {
  const clean = name.replace(/\s+/g, ' ').trim()
  if (!clean) throw badRequest('Bitte gib einen Namen ein.')
  if (clean.length > MAX_DECK_NAME) throw badRequest(`Der Name darf höchstens ${MAX_DECK_NAME} Zeichen lang sein.`)
  const taken = getDb()
    .prepare('SELECT 1 FROM decks WHERE user_id = ? AND name = ? COLLATE NOCASE AND id != ?')
    .get(userId, clean, excludeId ?? '')
  if (taken) throw conflict('Es gibt bereits einen Stapel mit diesem Namen.', 'name_taken')
  return clean
}

export type DeckInput = { id?: string; name: string; description?: string; newPerDay?: number }

export function createDeck(userId: number, input: DeckInput): Deck {
  const name = checkDeckName(userId, input.name)
  const id = input.id && isValidId(input.id) ? input.id : uuid()
  const t = Date.now()
  getDb()
    .prepare(
      'INSERT INTO decks (id, user_id, name, description, new_per_day, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(id, userId, name, (input.description ?? '').trim(), input.newPerDay ?? DEFAULT_NEW_PER_DAY, t, t)
  return toDeck(getDeckRow(userId, id))
}

export function updateDeck(userId: number, id: string, patch: Partial<Omit<DeckInput, 'id'>>): Deck {
  const deck = getDeckRow(userId, id)
  const name = patch.name !== undefined ? checkDeckName(userId, patch.name, id) : deck.name
  getDb()
    .prepare('UPDATE decks SET name = ?, description = ?, new_per_day = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(
      name,
      patch.description !== undefined ? patch.description.trim() : deck.description,
      patch.newPerDay ?? deck.new_per_day,
      Date.now(),
      id,
      userId,
    )
  return toDeck(getDeckRow(userId, id))
}

/** Löscht den Stapel mit allen Karten und dem Lernstand. */
export function deleteDeck(userId: number, id: string): { deletedCards: number } {
  getDeckRow(userId, id)
  const db = getDb()
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM cards WHERE deck_id = ?').get(id) as { n: number }
  db.prepare('DELETE FROM decks WHERE id = ? AND user_id = ?').run(id, userId)
  return { deletedCards: n }
}

/** Lernstand eines Stapels zurücksetzen – alle Karten gelten danach wieder als neu. */
export function resetDeckProgress(userId: number, id: string): { reset: number } {
  getDeckRow(userId, id)
  const res = getDb()
    .prepare('DELETE FROM card_reviews WHERE user_id = ? AND card_id IN (SELECT id FROM cards WHERE deck_id = ?)')
    .run(userId, id)
  return { reset: res.changes }
}

// ---------------------------------------------------------------------------
// Karten
// ---------------------------------------------------------------------------

export type CardInput = {
  type: CardType
  front: string
  back?: string
  options?: CardOption[]
  noteId?: string | null
}

type CleanCard = { type: CardType; front: string; back: string; options: CardOption[]; noteId: string | null }

/** Prüft und bereinigt eine Karte (Texte begrenzt, Multiple Choice mit mind. 2 Antworten, davon mind. 1 richtig). */
function cleanCard(input: CardInput): CleanCard {
  const front = input.front.replace(/\r\n?/g, '\n').trim()
  const back = (input.back ?? '').replace(/\r\n?/g, '\n').trim()
  if (!front) throw badRequest('Die Vorderseite darf nicht leer sein.')
  if (front.length > MAX_CARD_TEXT || back.length > MAX_CARD_TEXT) {
    throw badRequest(`Eine Kartenseite darf höchstens ${MAX_CARD_TEXT.toLocaleString('de-DE')} Zeichen lang sein.`)
  }
  let options: CardOption[] = []
  if (input.type === 'mc') {
    options = (input.options ?? [])
      .map((o) => ({ text: o.text.replace(/\s*\n\s*/g, ' ').trim(), correct: !!o.correct }))
      .filter((o) => o.text)
    if (options.length < 2) throw badRequest('Multiple Choice braucht mindestens zwei Antworten.')
    if (options.length > MAX_OPTIONS) throw badRequest(`Höchstens ${MAX_OPTIONS} Antworten.`)
    if (options.some((o) => o.text.length > MAX_OPTION_TEXT)) throw badRequest('Eine Antwort ist zu lang.')
    if (!options.some((o) => o.correct)) throw badRequest('Markiere mindestens eine richtige Antwort.')
  } else if (!back) {
    throw badRequest('Die Rückseite darf nicht leer sein.')
  }
  const noteId = input.noteId && isValidId(input.noteId) ? input.noteId : null
  return { type: input.type, front, back, options, noteId }
}

function getCardRow(userId: number, id: string): CardRow {
  const row = getDb().prepare('SELECT * FROM cards WHERE id = ? AND user_id = ?').get(id, userId) as CardRow | undefined
  if (!row) throw notFound('Karte nicht gefunden.')
  return row
}

function nextPosition(deckId: string): number {
  const row = getDb().prepare('SELECT MAX(position) AS p FROM cards WHERE deck_id = ?').get(deckId) as { p: number | null }
  return (row.p ?? -1) + 1
}

/** Legt eine oder mehrere Karten am Ende des Stapels an. */
export function createCards(userId: number, deckId: string, inputs: CardInput[]): Card[] {
  getDeckRow(userId, deckId)
  const cleaned = inputs.map(cleanCard)
  const db = getDb()
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM cards WHERE user_id = ?').get(userId) as { n: number }
  if (n + cleaned.length > MAX_CARDS_PER_USER) {
    throw new ApiError(413, 'too_many_cards', `Höchstens ${MAX_CARDS_PER_USER.toLocaleString('de-DE')} Karten pro Konto.`)
  }
  const insert = db.prepare(
    `INSERT INTO cards (id, user_id, deck_id, note_id, type, front, back, options, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const ids: string[] = []
  db.transaction(() => {
    let position = nextPosition(deckId)
    const t = Date.now()
    for (const c of cleaned) {
      const id = uuid()
      insert.run(id, userId, deckId, c.noteId, c.type, c.front, c.back, JSON.stringify(c.options), position++, t, t)
      ids.push(id)
    }
    db.prepare('UPDATE decks SET updated_at = ? WHERE id = ?').run(t, deckId)
  })()
  return ids.map((id) => toCard(getCardRow(userId, id)))
}

export function updateCard(userId: number, id: string, patch: Partial<CardInput> & { deckId?: string }): Card {
  const row = getCardRow(userId, id)
  const current = toCard(row)
  const next = cleanCard({
    type: patch.type ?? current.type,
    front: patch.front ?? current.front,
    back: patch.back ?? current.back,
    options: patch.options ?? current.options,
    noteId: patch.noteId !== undefined ? patch.noteId : current.noteId,
  })
  const db = getDb()
  let deckId = row.deck_id
  let position = row.position
  if (patch.deckId && patch.deckId !== row.deck_id) {
    getDeckRow(userId, patch.deckId)
    deckId = patch.deckId
    position = nextPosition(deckId)
  }
  db.transaction(() => {
    db.prepare(
      `UPDATE cards SET deck_id = ?, note_id = ?, type = ?, front = ?, back = ?, options = ?, position = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    ).run(deckId, next.noteId, next.type, next.front, next.back, JSON.stringify(next.options), position, Date.now(), id, userId)
    // Aus einer beidseitigen wird eine einseitige Karte: Lernstand der Rückseite verwerfen
    if (next.type !== 'reversed') db.prepare('DELETE FROM card_reviews WHERE card_id = ? AND side = 1').run(id)
  })()
  return toCard(getCardRow(userId, id))
}

export function deleteCard(userId: number, id: string) {
  getCardRow(userId, id)
  getDb().prepare('DELETE FROM cards WHERE id = ? AND user_id = ?').run(id, userId)
}

// ---------------------------------------------------------------------------
// Lernstand
// ---------------------------------------------------------------------------

/**
 * Übernimmt Bewertungen (auch offline gesammelte). Pro Kartenseite gewinnt die jüngste Bewertung –
 * so kann ein Gerät, das länger offline war, keinen neueren Stand eines anderen Geräts überschreiben.
 * Bewertungen gelöschter Karten werden ignoriert.
 */
export function saveReviews(userId: number, reviews: CardReview[]): { saved: number } {
  const db = getDb()
  const cardType = db.prepare('SELECT type FROM cards WHERE id = ? AND user_id = ?')
  const upsert = db.prepare(
    `INSERT INTO card_reviews (card_id, side, user_id, phase, step, interval, ease, reps, lapses, due, reviewed_at, introduced_at)
     VALUES (@cardId, @side, @userId, @phase, @step, @interval, @ease, @reps, @lapses, @due, @reviewedAt, @introducedAt)
     ON CONFLICT (card_id, side) DO UPDATE SET
       phase = excluded.phase, step = excluded.step, interval = excluded.interval, ease = excluded.ease,
       reps = excluded.reps, lapses = excluded.lapses, due = excluded.due, reviewed_at = excluded.reviewed_at,
       introduced_at = MIN(card_reviews.introduced_at, excluded.introduced_at)
     WHERE excluded.reviewed_at > card_reviews.reviewed_at`,
  )
  let saved = 0
  db.transaction(() => {
    for (const r of reviews) {
      const card = cardType.get(r.cardId, userId) as { type: CardType } | undefined
      if (!card || (r.side === 1 && card.type !== 'reversed')) continue
      saved += upsert.run({ ...r, userId }).changes
    }
  })()
  return { saved }
}

// ---------------------------------------------------------------------------
// Eingabeprüfung für die API
// ---------------------------------------------------------------------------

export const deckSchema = z.object({
  name: z.string().max(1000),
  description: z.string().max(5000).optional(),
  newPerDay: z.number().int().min(0).max(9999).optional(),
})

export const cardSchema = z.object({
  type: z.enum(['basic', 'reversed', 'mc']),
  front: z.string().max(MAX_CARD_TEXT * 2),
  back: z.string().max(MAX_CARD_TEXT * 2).optional(),
  options: z
    .array(z.object({ text: z.string().max(MAX_OPTION_TEXT * 2), correct: z.boolean() }))
    .max(MAX_OPTIONS * 2)
    .optional(),
  noteId: z.string().uuid().nullable().optional(),
})

const time = z.number().int().min(0).max(8_640_000_000_000_000)

export const reviewSchema = z.object({
  cardId: z.string().uuid(),
  side: z.union([z.literal(0), z.literal(1)]),
  phase: z.enum(['learning', 'review', 'relearning']),
  step: z.number().int().min(0).max(100),
  interval: z.number().min(0).max(100_000),
  ease: z.number().min(1).max(10),
  reps: z.number().int().min(0).max(1_000_000),
  lapses: z.number().int().min(0).max(1_000_000),
  due: time,
  reviewedAt: time,
  introducedAt: time,
})
