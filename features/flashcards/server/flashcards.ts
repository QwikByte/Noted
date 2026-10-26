import 'server-only'
import { z } from 'zod'
import { getDb } from '@/shared/server/db'
import { ApiError, badRequest, conflict, notFound } from '@/shared/server/http'
import { isValidId, uuid } from '@/shared/server/crypto'
import {
  MAX_ANSWER_MS,
  MAX_CARD_TEXT,
  MAX_CLOZES,
  MAX_MASK_LABEL,
  MAX_MASKS,
  MAX_NEW_PER_DAY,
  MAX_OPTION_TEXT,
  MAX_OPTIONS,
} from '../limits'
import { clozeCount, normalizeCloze } from '../cloze'
import { fitMask, occlusionError, withMaskIds } from '../occlusion'
import { movedSides, remapSides, sidesOf } from '../study'
import { DEFAULT_NEW_PER_DAY, DEFAULT_RETENTION } from '../srs'
import { getFsrsParams } from './fsrs-params'
import type {
  Card,
  CardOption,
  CardReview,
  CardType,
  CardUpdateResult,
  Deck,
  FlashcardData,
  Occlusion,
  ReviewLogEntry,
  ReviewUndo,
} from '../types'

const MAX_CARDS_PER_USER = 50_000
const MAX_DECK_NAME = 200

type DeckRow = {
  id: string
  user_id: number
  name: string
  description: string
  new_per_day: number
  type_answer: 0 | 1
  scheduler: 'sm2' | 'fsrs'
  retention: number
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
  occlusion: string | null
  position: number
  suspended: 0 | 1
  created_at: number
  updated_at: number
}

type ReviewRow = {
  card_id: string
  side: number
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
  stability: number | null
  difficulty: number | null
}

const toDeck = (r: DeckRow): Deck => ({
  id: r.id,
  name: r.name,
  description: r.description,
  newPerDay: r.new_per_day,
  typeAnswer: r.type_answer === 1,
  scheduler: r.scheduler,
  retention: r.retention,
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

function parseOcclusion(raw: string | null): Occlusion | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as Occlusion
    if (!Array.isArray(o.masks) || typeof o.image !== 'string') return null
    // Flächen aus der Zeit vor den Kennungen: die Position als Kennung, bis die Karte das nächste Mal gespeichert wird
    return o.masks.every((m) => m.id) ? o : { ...o, masks: o.masks.map((m, i) => ({ ...m, id: String(i) })) }
  } catch {
    return null
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
  occlusion: parseOcclusion(r.occlusion),
  position: r.position,
  suspended: r.suspended === 1,
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
  ...(r.stability != null && r.difficulty != null ? { stability: r.stability, difficulty: r.difficulty } : {}),
})

/** Alles auf einmal – der Browser berechnet daraus fällige Karten und Lernsitzungen (auch offline). */
export function getFlashcardData(userId: number): FlashcardData {
  const db = getDb()
  const decks = (db.prepare('SELECT * FROM decks WHERE user_id = ? ORDER BY name COLLATE NOCASE').all(userId) as DeckRow[]).map(toDeck)
  const cards = (
    db.prepare('SELECT * FROM cards WHERE user_id = ? ORDER BY deck_id, position, created_at').all(userId) as CardRow[]
  ).map(toCard)
  const reviews = (db.prepare('SELECT * FROM card_reviews WHERE user_id = ?').all(userId) as ReviewRow[]).map(toReview)
  return { decks, cards, reviews, fsrs: getFsrsParams(userId) }
}

// ---------------------------------------------------------------------------
// Stapel
// ---------------------------------------------------------------------------

function getDeckRow(userId: number, id: string): DeckRow {
  const row = getDb().prepare('SELECT * FROM decks WHERE id = ? AND user_id = ?').get(id, userId) as DeckRow | undefined
  if (!row) throw notFound('Stapel nicht gefunden.')
  return row
}

export function getDeck(userId: number, id: string): Deck {
  return toDeck(getDeckRow(userId, id))
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

type DeckInput = {
  id?: string
  name: string
  description?: string
  newPerDay?: number
  typeAnswer?: boolean
  scheduler?: Deck['scheduler']
  retention?: number
}

export function createDeck(userId: number, input: DeckInput): Deck {
  const name = checkDeckName(userId, input.name)
  const id = input.id && isValidId(input.id) ? input.id : uuid()
  const t = Date.now()
  getDb()
    .prepare(
      `INSERT INTO decks (id, user_id, name, description, new_per_day, type_answer, scheduler, retention, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      name,
      (input.description ?? '').trim(),
      input.newPerDay ?? DEFAULT_NEW_PER_DAY,
      input.typeAnswer ? 1 : 0,
      input.scheduler ?? 'sm2',
      input.retention ?? DEFAULT_RETENTION,
      t,
      t,
    )
  return toDeck(getDeckRow(userId, id))
}

export function updateDeck(userId: number, id: string, patch: Partial<Omit<DeckInput, 'id'>>): Deck {
  const deck = getDeckRow(userId, id)
  const name = patch.name !== undefined ? checkDeckName(userId, patch.name, id) : deck.name
  getDb()
    .prepare(
      `UPDATE decks SET name = ?, description = ?, new_per_day = ?, type_answer = ?, scheduler = ?, retention = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
    .run(
      name,
      patch.description !== undefined ? patch.description.trim() : deck.description,
      patch.newPerDay ?? deck.new_per_day,
      patch.typeAnswer !== undefined ? (patch.typeAnswer ? 1 : 0) : deck.type_answer,
      patch.scheduler ?? deck.scheduler,
      patch.retention ?? deck.retention,
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
  occlusion?: Occlusion | null
  noteId?: string | null
}

type CleanCard = {
  type: CardType
  front: string
  back: string
  options: CardOption[]
  occlusion: Occlusion | null
  noteId: string | null
}

/**
 * Prüft und bereinigt eine Karte (Texte begrenzt, Multiple Choice mit mind. 2 Antworten, davon mind. 1 richtig,
 * Lückentext mit mind. einer Lücke – {{Lücke}} wird dabei zu ==Lücke==, Bildverdeckung mit Bild und mind. einer Fläche,
 * jede mit eigener Kennung). `previous`: die Bildverdeckung vor dem Bearbeiten.
 */
function cleanCard(input: CardInput, previous: Occlusion | null = null): CleanCard {
  const raw = input.front.replace(/\r\n?/g, '\n').trim()
  const front = input.type === 'cloze' ? normalizeCloze(raw) : raw
  const back = (input.back ?? '').replace(/\r\n?/g, '\n').trim()
  if (!front) throw badRequest('Die Vorderseite darf nicht leer sein.')
  if (front.length > MAX_CARD_TEXT || back.length > MAX_CARD_TEXT) {
    throw badRequest(`Eine Kartenseite darf höchstens ${MAX_CARD_TEXT.toLocaleString('de-DE')} Zeichen lang sein.`)
  }
  let options: CardOption[] = []
  let occlusion: Occlusion | null = null
  if (input.type === 'mc') {
    options = (input.options ?? [])
      .map((o) => ({ text: o.text.replace(/\s*\n\s*/g, ' ').trim(), correct: !!o.correct }))
      .filter((o) => o.text)
    if (options.length < 2) throw badRequest('Multiple Choice braucht mindestens zwei Antworten.')
    if (options.length > MAX_OPTIONS) throw badRequest(`Höchstens ${MAX_OPTIONS} Antworten.`)
    if (options.some((o) => o.text.length > MAX_OPTION_TEXT)) throw badRequest('Eine Antwort ist zu lang.')
    if (!options.some((o) => o.correct)) throw badRequest('Markiere mindestens eine richtige Antwort.')
  } else if (input.type === 'cloze') {
    const n = clozeCount(front)
    if (n === 0) throw badRequest('Markiere mindestens eine Lücke, z. B. ==Begriff== oder {{Begriff}}.')
    if (n > MAX_CLOZES) throw badRequest(`Höchstens ${MAX_CLOZES} Lücken pro Karte.`)
  } else if (input.type === 'occlusion') {
    const o = input.occlusion
    occlusion = o ? { image: o.image.trim(), masks: withMaskIds(o.masks.map(fitMask), previous?.masks), hideAll: !!o.hideAll } : null
    const error = occlusion ? occlusionError(occlusion) : 'Bitte wähle ein Bild.'
    if (error) throw badRequest(error)
  } else if (!back) {
    throw badRequest('Die Rückseite darf nicht leer sein.')
  }
  const noteId = input.noteId && isValidId(input.noteId) ? input.noteId : null
  return { type: input.type, front, back, options, occlusion, noteId }
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
  const cleaned = inputs.map((input) => cleanCard(input))
  const db = getDb()
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM cards WHERE user_id = ?').get(userId) as { n: number }
  if (n + cleaned.length > MAX_CARDS_PER_USER) {
    throw new ApiError(413, 'too_many_cards', `Höchstens ${MAX_CARDS_PER_USER.toLocaleString('de-DE')} Karten pro Konto.`)
  }
  const insert = db.prepare(
    `INSERT INTO cards (id, user_id, deck_id, note_id, type, front, back, options, occlusion, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const ids: string[] = []
  db.transaction(() => {
    let position = nextPosition(deckId)
    const t = Date.now()
    for (const c of cleaned) {
      const id = uuid()
      const occlusion = c.occlusion ? JSON.stringify(c.occlusion) : null
      insert.run(id, userId, deckId, c.noteId, c.type, c.front, c.back, JSON.stringify(c.options), occlusion, position++, t, t)
      ids.push(id)
    }
    db.prepare('UPDATE decks SET updated_at = ? WHERE id = ?').run(t, deckId)
  })()
  return ids.map((id) => toCard(getCardRow(userId, id)))
}

/**
 * Karten in Blöcken anlegen (Importe); lehnt der Server einen Block ab, Karte für Karte – ungültige werden übersprungen
 * und mit Grund an `skip` gemeldet. Nur das Kartenlimit des Kontos bricht ab.
 */
export function createCardsSkipping<T extends { input: CardInput }>(
  userId: number,
  deckId: string,
  items: T[],
  skip: (reason: string) => void,
): [T, Card][] {
  const out: [T, Card][] = []
  for (let i = 0; i < items.length; i += 500) {
    const chunk = items.slice(i, i + 500)
    try {
      createCards(userId, deckId, chunk.map((d) => d.input)).forEach((card, k) => out.push([chunk[k], card]))
      continue
    } catch (err) {
      if (!(err instanceof ApiError) || err.status === 413) throw err
    }
    for (const d of chunk) {
      try {
        out.push([d, createCards(userId, deckId, [d.input])[0]])
      } catch (err) {
        if (!(err instanceof ApiError) || err.status === 413) throw err
        skip(`„${d.input.front.slice(0, 60)}“ (${err.message})`)
      }
    }
  }
  return out
}

/** Karten aussetzen bzw. wieder freigeben, ohne sie sonst zu ändern (Importe) */
export function setSuspended(userId: number, ids: string[], suspended: boolean) {
  const db = getDb()
  const stmt = db.prepare('UPDATE cards SET suspended = ? WHERE id = ? AND user_id = ?')
  db.transaction(() => ids.forEach((id) => stmt.run(suspended ? 1 : 0, id, userId)))()
}

export function updateCard(
  userId: number,
  id: string,
  patch: Partial<CardInput> & { deckId?: string; suspended?: boolean },
): CardUpdateResult {
  const row = getCardRow(userId, id)
  const current = toCard(row)
  const next = cleanCard(
    {
      type: patch.type ?? current.type,
      front: patch.front ?? current.front,
      back: patch.back ?? current.back,
      options: patch.options ?? current.options,
      occlusion: patch.occlusion !== undefined ? patch.occlusion : current.occlusion,
      noteId: patch.noteId !== undefined ? patch.noteId : current.noteId,
    },
    current.occlusion,
  )
  const sideMap = remapSides(current, next)
  const db = getDb()
  let deckId = row.deck_id
  let position = row.position
  if (patch.deckId && patch.deckId !== row.deck_id) {
    getDeckRow(userId, patch.deckId)
    deckId = patch.deckId
    position = nextPosition(deckId)
  }
  const suspended = patch.suspended !== undefined ? (patch.suspended ? 1 : 0) : row.suspended
  db.transaction(() => {
    db.prepare(
      `UPDATE cards SET deck_id = ?, note_id = ?, type = ?, front = ?, back = ?, options = ?, occlusion = ?, position = ?,
         suspended = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    ).run(
      deckId,
      next.noteId,
      next.type,
      next.front,
      next.back,
      JSON.stringify(next.options),
      next.occlusion ? JSON.stringify(next.occlusion) : null,
      position,
      suspended,
      Date.now(),
      id,
      userId,
    )
    moveSides(userId, id, sideMap, sidesOf(current).length)
  })()
  return { card: toCard(getCardRow(userId, id)), sideMap }
}

/**
 * Lernstand und Protokoll ziehen mit ihrer Lücke bzw. Fläche um (`sideMap` aus `remapSides`). Weggefallene Seiten
 * (aus beidseitig wird einseitig, eine Lücke oder Fläche fällt weg) verlieren ihren Lernstand. Ihre Protokolleinträge
 * bleiben für die Statistik, gehören aber wie die gelöschter Karten zu keiner Karte mehr – sonst vermischte der
 * FSRS-Optimierer sie mit dem Verlauf der Seite, die jetzt diese Nummer trägt. Läuft in der Transaktion des Aufrufers.
 */
function moveSides(userId: number, cardId: string, sideMap: (number | null)[], before: number) {
  if (sideMap.length === before && sideMap.every((old, side) => old === side)) return
  const db = getDb()
  const moved = movedSides(sideMap)
  // Neu einfügen statt umnummerieren – der Primärschlüssel (card_id, side) ließe kein Tauschen zu
  const reviews = db.prepare('SELECT * FROM card_reviews WHERE card_id = ? AND user_id = ?').all(cardId, userId) as ReviewRow[]
  db.prepare('DELETE FROM card_reviews WHERE card_id = ? AND user_id = ?').run(cardId, userId)
  const insert = db.prepare(
    `INSERT INTO card_reviews
       (card_id, side, user_id, phase, step, interval, ease, stability, difficulty, reps, lapses, due, reviewed_at, introduced_at)
     VALUES (@card_id, @side, @user_id, @phase, @step, @interval, @ease, @stability, @difficulty, @reps, @lapses, @due,
       @reviewed_at, @introduced_at)`,
  )
  for (const r of reviews) {
    const side = moved.get(r.side)
    if (side !== undefined) insert.run({ ...r, side })
  }
  // Erst alle Einträge beiseite, dann an ihre neue Seite – sonst stießen sie unterwegs an den eindeutigen Index
  const parked = `${cardId}:${Date.now()}`
  db.prepare('UPDATE review_log SET card_id = ? WHERE user_id = ? AND card_id = ?').run(parked, userId, cardId)
  const sides = db.prepare('SELECT DISTINCT side FROM review_log WHERE user_id = ? AND card_id = ?').all(userId, parked) as {
    side: number
  }[]
  const move = db.prepare('UPDATE review_log SET card_id = ?, side = ? WHERE user_id = ? AND card_id = ? AND side = ?')
  for (const { side } of sides) {
    const to = moved.get(side)
    move.run(to === undefined ? `${parked}:${side}` : cardId, to ?? side, userId, parked, side)
  }
}

/** Karte neu lernen (z. B. nach dem Überarbeiten einer Problemkarte): Lernstand weg, Aussetzen aufgehoben. */
export function resetCardProgress(userId: number, id: string): Card {
  getCardRow(userId, id)
  const db = getDb()
  db.transaction(() => {
    db.prepare('DELETE FROM card_reviews WHERE card_id = ? AND user_id = ?').run(id, userId)
    db.prepare('UPDATE cards SET suspended = 0, updated_at = ? WHERE id = ? AND user_id = ?').run(Date.now(), id, userId)
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
 * `log` kommt ins Bewertungsprotokoll; doppelt gesendete Einträge zählen nur einmal.
 * Bewertungen gelöschter Karten werden ignoriert.
 */
export function saveReviews(userId: number, reviews: CardReview[], log: ReviewLogEntry[] = []): { saved: number; logged: number } {
  const db = getDb()
  const cardInfo = db.prepare('SELECT type, front, occlusion, deck_id FROM cards WHERE id = ? AND user_id = ?')
  const upsert = db.prepare(
    `INSERT INTO card_reviews
       (card_id, side, user_id, phase, step, interval, ease, reps, lapses, due, reviewed_at, introduced_at, stability, difficulty)
     VALUES (@cardId, @side, @userId, @phase, @step, @interval, @ease, @reps, @lapses, @due, @reviewedAt, @introducedAt,
       @stability, @difficulty)
     ON CONFLICT (card_id, side) DO UPDATE SET
       phase = excluded.phase, step = excluded.step, interval = excluded.interval, ease = excluded.ease,
       reps = excluded.reps, lapses = excluded.lapses, due = excluded.due, reviewed_at = excluded.reviewed_at,
       stability = excluded.stability, difficulty = excluded.difficulty,
       introduced_at = MIN(card_reviews.introduced_at, excluded.introduced_at)
     WHERE excluded.reviewed_at > card_reviews.reviewed_at`,
  )
  const insertLog = db.prepare(
    `INSERT OR IGNORE INTO review_log
       (user_id, card_id, deck_id, side, rating, phase, interval_before, interval_after, duration_ms, reviewed_at)
     VALUES (@userId, @cardId, @deckId, @side, @rating, @phase, @intervalBefore, @intervalAfter, @durationMs, @reviewedAt)`,
  )
  let saved = 0
  let logged = 0
  db.transaction(() => {
    // Nur Seiten, die die Karte (noch) hat
    const card = (id: string, side: number) => {
      const c = cardInfo.get(id, userId) as { type: CardType; front: string; occlusion: string | null; deck_id: string } | undefined
      return c && side < sidesOf({ ...c, occlusion: parseOcclusion(c.occlusion) }).length ? c : null
    }
    for (const r of reviews) {
      if (card(r.cardId, r.side)) {
        saved += upsert.run({ ...r, userId, stability: r.stability ?? null, difficulty: r.difficulty ?? null }).changes
      }
    }
    for (const e of log) {
      const c = card(e.cardId, e.side)
      if (c) logged += insertLog.run({ ...e, userId, deckId: c.deck_id }).changes
    }
  })()
  return { saved, logged }
}

/**
 * Nimmt Bewertungen zurück („Rückgängig“ beim Lernen), je Kartenseite die jüngste zuerst. Steht die Seite noch genau
 * auf dieser Bewertung, bekommt sie ihren Stand davor zurück bzw. ist wieder neu. Der Protokolleintrag entfällt, sofern
 * kein neuerer Stand vorliegt – wurde auf einem anderen Gerät inzwischen weitergelernt, bleibt alles, wie es ist.
 * Liefert die Zahl der Rücknahmen, die etwas geändert haben.
 */
export function undoReviews(userId: number, items: ReviewUndo[]): number {
  const db = getDb()
  const current = db.prepare('SELECT reviewed_at FROM card_reviews WHERE card_id = ? AND side = ? AND user_id = ?')
  const remove = db.prepare('DELETE FROM card_reviews WHERE card_id = ? AND side = ? AND user_id = ?')
  const restore = db.prepare(
    `UPDATE card_reviews SET
       phase = @phase, step = @step, interval = @interval, ease = @ease, reps = @reps, lapses = @lapses, due = @due,
       reviewed_at = @reviewedAt, introduced_at = @introducedAt, stability = @stability, difficulty = @difficulty
     WHERE card_id = @cardId AND side = @side AND user_id = @userId`,
  )
  const unlog = db.prepare('DELETE FROM review_log WHERE user_id = ? AND card_id = ? AND side = ? AND reviewed_at = ?')
  let undone = 0
  db.transaction(() => {
    for (const u of [...items].sort((a, b) => b.reviewedAt - a.reviewedAt)) {
      const row = current.get(u.cardId, u.side, userId) as { reviewed_at: number } | undefined
      if (row && row.reviewed_at > u.reviewedAt) continue
      let changes = 0
      if (row?.reviewed_at === u.reviewedAt) {
        const { cardId, side, previous } = u
        changes += previous
          ? restore.run({ ...previous, cardId, side, userId, stability: previous.stability ?? null, difficulty: previous.difficulty ?? null })
              .changes
          : remove.run(cardId, side, userId).changes
      }
      changes += unlog.run(userId, u.cardId, u.side, u.reviewedAt).changes
      if (changes > 0) undone++
    }
  })()
  return undone
}

const valid = <T>(schema: z.ZodType<T>, list: unknown[]): T[] =>
  list.flatMap((item) => {
    const parsed = schema.safeParse(item)
    return parsed.success ? [parsed.data] : []
  })

/**
 * Bewertungen aus dem Browser: Jeder Eintrag wird einzeln geprüft – ein ungültiger verwirft nicht die übrigen, die
 * womöglich tagelang offline gesammelt wurden. Rücknahmen (`undo`) gelten vor den Bewertungen derselben Anfrage –
 * so kann eine zurückgenommene und gleich neu bewertete Karte in einem Rutsch ankommen.
 */
export function saveSubmittedReviews(userId: number, reviews: unknown[], log: unknown[] = [], undo: unknown[] = []) {
  const validReviews = valid(reviewSchema, reviews)
  const validLog = valid(reviewLogSchema, log)
  const validUndo = valid(reviewUndoSchema, undo)
  const rejected =
    reviews.length - validReviews.length + log.length - validLog.length + undo.length - validUndo.length
  if (rejected > 0) console.error(`[noted] ${rejected} ungültige Bewertungen verworfen`)
  return getDb().transaction(() => {
    const undone = undoReviews(userId, validUndo)
    return { ...saveReviews(userId, validReviews, validLog), undone, rejected }
  })()
}

// ---------------------------------------------------------------------------
// Eingabeprüfung für die API
// ---------------------------------------------------------------------------

export const deckSchema = z.object({
  name: z.string().max(1000),
  description: z.string().max(5000).optional(),
  newPerDay: z.number().int().min(0).max(MAX_NEW_PER_DAY).optional(),
  typeAnswer: z.boolean().optional(),
  scheduler: z.enum(['sm2', 'fsrs']).optional(),
  retention: z.number().min(0.7).max(0.99).optional(),
})

export const cardSchema = z.object({
  type: z.enum(['basic', 'reversed', 'mc', 'cloze', 'occlusion']),
  front: z.string().max(MAX_CARD_TEXT * 2),
  back: z.string().max(MAX_CARD_TEXT * 2).optional(),
  options: z
    .array(z.object({ text: z.string().max(MAX_OPTION_TEXT * 2), correct: z.boolean() }))
    .max(MAX_OPTIONS * 2)
    .optional(),
  occlusion: z
    .object({
      image: z.string().max(1000),
      masks: z
        .array(
          z.object({
            id: z
              .string()
              .regex(/^[\w-]{1,64}$/)
              .optional(),
            x: z.number().min(0).max(1),
            y: z.number().min(0).max(1),
            w: z.number().min(0).max(1),
            h: z.number().min(0).max(1),
            label: z.string().max(MAX_MASK_LABEL * 2),
          }),
        )
        .max(MAX_MASKS * 2),
      hideAll: z.boolean(),
    })
    .nullable()
    .optional(),
  noteId: z.string().uuid().nullable().optional(),
})

const time = z.number().int().min(0).max(8_640_000_000_000_000)

const side = z.number().int().min(0).max(MAX_CLOZES - 1)

export const reviewSchema = z.object({
  cardId: z.string().uuid(),
  side,
  phase: z.enum(['learning', 'review', 'relearning']),
  step: z.number().int().min(0).max(100),
  interval: z.number().min(0).max(100_000),
  ease: z.number().min(1).max(10),
  reps: z.number().int().min(0).max(1_000_000),
  lapses: z.number().int().min(0).max(1_000_000),
  due: time,
  reviewedAt: time,
  introducedAt: time,
  stability: z.number().min(0.01).max(36_500).nullable().optional(),
  difficulty: z.number().min(1).max(10).nullable().optional(),
})

export const reviewLogSchema = z.object({
  cardId: z.string().uuid(),
  side,
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  phase: z.enum(['new', 'learning', 'review', 'relearning']),
  intervalBefore: z.number().min(0).max(100_000),
  intervalAfter: z.number().min(0).max(100_000),
  durationMs: z.number().int().min(0).max(MAX_ANSWER_MS),
  reviewedAt: time,
})

const reviewUndoSchema = z
  .object({
    cardId: z.string().uuid(),
    side,
    reviewedAt: time,
    previous: reviewSchema.omit({ cardId: true, side: true }).nullable(),
  })
  .refine((u) => !u.previous || u.previous.reviewedAt < u.reviewedAt)
