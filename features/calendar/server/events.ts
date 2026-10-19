import 'server-only'
import { z } from 'zod'
import { getDb } from '@/shared/server/db'
import { badRequest, notFound } from '@/shared/server/http'
import { uuid } from '@/shared/server/crypto'
import { addDays, DATE_RE } from '../dates'
import { eventError, occurrences } from '../event'
import { toIcs } from '../ics'
import {
  MAX_EXAM_DECKS,
  MAX_EXDATES,
  MAX_IMPORT_EVENTS,
  MAX_LOCATION,
  MAX_NOTES,
  MAX_REPEAT_WEEKS,
  MAX_TITLE,
  MAX_UID,
} from '../limits'
import type { CalendarEvent, EventColor, EventInput, ImportedEvent } from '../types'

const MAX_EVENTS_PER_USER = 20_000

type EventRow = {
  id: string
  user_id: number
  title: string
  location: string
  notes: string
  color: EventColor | null
  all_day: 0 | 1
  start_at: string
  end_at: string
  repeat_weeks: number | null
  repeat_until: string | null
  exdates: string
  exam: 0 | 1
  uid: string | null
  created_at: number
  updated_at: number
}

function parseExdates(raw: string): string[] {
  try {
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list.filter((d) => typeof d === 'string') : []
  } catch {
    return []
  }
}

const toEvent = (r: EventRow, deckIds: string[] = []): CalendarEvent => ({
  id: r.id,
  title: r.title,
  location: r.location,
  notes: r.notes,
  color: r.color,
  allDay: r.all_day === 1,
  start: r.start_at,
  end: r.end_at,
  repeat: r.repeat_weeks ? { weeks: r.repeat_weeks, until: r.repeat_until } : null,
  exdates: parseExdates(r.exdates),
  exam: r.exam === 1 ? { deckIds } : null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

function getRow(userId: number, id: string): EventRow {
  const row = getDb().prepare('SELECT * FROM events WHERE id = ? AND user_id = ?').get(id, userId) as EventRow | undefined
  if (!row) throw notFound('Termin nicht gefunden.')
  return row
}

/** Termine samt der mit Klausuren verknüpften Stapel */
function toEvents(userId: number, rows: EventRow[]): CalendarEvent[] {
  const exams = rows.filter((r) => r.exam === 1)
  const decks = new Map<string, string[]>()
  if (exams.length > 0) {
    const sql = 'SELECT x.event_id, x.deck_id FROM exam_decks x JOIN events e ON e.id = x.event_id WHERE e.user_id = ?'
    const links = (
      exams.length === 1 ? getDb().prepare(`${sql} AND e.id = ?`).all(userId, exams[0].id) : getDb().prepare(sql).all(userId)
    ) as { event_id: string; deck_id: string }[]
    for (const l of links) decks.set(l.event_id, [...(decks.get(l.event_id) ?? []), l.deck_id])
  }
  return rows.map((r) => toEvent(r, decks.get(r.id)))
}

const getEvent = (userId: number, id: string) => toEvents(userId, [getRow(userId, id)])[0]

/** Stapel einer Klausur festlegen – nur eigene; gelöschte (z. B. auf einem anderen Gerät) fallen weg */
function saveExamDecks(userId: number, eventId: string, e: EventInput) {
  const db = getDb()
  db.prepare('DELETE FROM exam_decks WHERE event_id IN (SELECT id FROM events WHERE id = ? AND user_id = ?)').run(eventId, userId)
  if (!e.exam?.deckIds.length) return
  db.prepare(
    `INSERT INTO exam_decks (event_id, deck_id)
       SELECT ?, id FROM decks WHERE user_id = ? AND id IN (SELECT value FROM json_each(?))`,
  ).run(eventId, userId, JSON.stringify(e.exam.deckIds))
}

/** Eingabe vereinheitlichen und prüfen – Ausnahmen gibt es nur bei Serien */
function clean(input: EventInput): EventInput {
  const e: EventInput = {
    ...input,
    title: input.title.replace(/\s+/g, ' ').trim(),
    location: input.location.trim(),
    notes: input.notes.trim(),
    exdates: input.repeat ? [...new Set(input.exdates)].sort() : [],
    exam: input.exam ? { deckIds: [...new Set(input.exam.deckIds)] } : null,
  }
  const error = eventError(e)
  if (error) throw badRequest(error)
  return e
}

function checkQuota(userId: number, adding: number) {
  const { n } = getDb().prepare('SELECT COUNT(*) AS n FROM events WHERE user_id = ?').get(userId) as { n: number }
  if (n + adding > MAX_EVENTS_PER_USER) throw badRequest(`Mehr als ${MAX_EVENTS_PER_USER} Termine sind nicht möglich.`)
}

/** Neuer Termin – innerhalb einer Transaktion aufrufen (Klausur und Stapel kommen zusammen an) */
function insert(userId: number, e: EventInput, uid: string | null = null): string {
  const id = uuid()
  const t = Date.now()
  getDb()
    .prepare(
      `INSERT INTO events (id, user_id, title, location, notes, color, all_day, start_at, end_at, repeat_weeks, repeat_until,
         exdates, exam, uid, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      e.title,
      e.location,
      e.notes,
      e.color,
      e.allDay ? 1 : 0,
      e.start,
      e.end,
      e.repeat?.weeks ?? null,
      e.repeat?.until ?? null,
      JSON.stringify(e.exdates),
      e.exam ? 1 : 0,
      uid,
      t,
      t,
    )
  if (e.exam) saveExamDecks(userId, id, e)
  return id
}

export function listEvents(userId: number): CalendarEvent[] {
  const rows = getDb().prepare('SELECT * FROM events WHERE user_id = ? ORDER BY start_at').all(userId) as EventRow[]
  return toEvents(userId, rows)
}

export function createEvent(userId: number, input: EventInput): CalendarEvent {
  const e = clean(input)
  checkQuota(userId, 1)
  const id = getDb().transaction(() => insert(userId, e))()
  return getEvent(userId, id)
}

/** Termin bzw. ganze Serie ändern */
export function updateEvent(userId: number, id: string, input: EventInput): CalendarEvent {
  getRow(userId, id)
  const e = clean(input)
  const db = getDb()
  db.transaction(() => {
    db.prepare(
      `UPDATE events SET title = ?, location = ?, notes = ?, color = ?, all_day = ?, start_at = ?, end_at = ?,
         repeat_weeks = ?, repeat_until = ?, exdates = ?, exam = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
    ).run(
      e.title,
      e.location,
      e.notes,
      e.color,
      e.allDay ? 1 : 0,
      e.start,
      e.end,
      e.repeat?.weeks ?? null,
      e.repeat?.until ?? null,
      JSON.stringify(e.exdates),
      e.exam ? 1 : 0,
      Date.now(),
      id,
      userId,
    )
    saveExamDecks(userId, id, e)
  })()
  return getEvent(userId, id)
}

export function deleteEvent(userId: number, id: string) {
  getRow(userId, id)
  getDb().prepare('DELETE FROM events WHERE id = ? AND user_id = ?').run(id, userId)
}

/**
 * Nur einen Termin einer Serie ändern oder absagen: Der Tag fällt in der Serie aus; mit `change` entsteht an seiner
 * Stelle ein einzelner Termin.
 */
export function changeOccurrence(
  userId: number,
  id: string,
  date: string,
  change: EventInput | null,
): { series: CalendarEvent; event: CalendarEvent | null } {
  const series = getEvent(userId, id)
  if (!series.repeat) throw badRequest('Der Termin wiederholt sich nicht.')
  if (!occurrences([series], date, addDays(date, 1)).some((o) => o.date === date)) {
    throw badRequest('Diesen Termin gibt es in der Serie nicht.')
  }
  const single = change ? clean({ ...change, repeat: null, exdates: [] }) : null
  if (series.exdates.length >= MAX_EXDATES) throw badRequest('Die Serie hat zu viele Ausnahmen.')
  if (single) checkQuota(userId, 1)

  const db = getDb()
  let eventId: string | null = null
  db.transaction(() => {
    db.prepare('UPDATE events SET exdates = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(
      JSON.stringify([...series.exdates, date].sort()),
      Date.now(),
      id,
      userId,
    )
    if (single) eventId = insert(userId, single)
  })()
  return { series: getEvent(userId, id), event: eventId ? getEvent(userId, eventId) : null }
}

/** Kennung, die Noted beim Export vergibt – so legt der Import eines eigenen Exports nichts doppelt an */
const NOTED_UID = /^([0-9a-f-]{36})@noted$/

/** Termine aus einer .ics-Datei übernehmen; schon vorhandene (gleiche Kennung) werden übersprungen */
export function importEvents(userId: number, events: ImportedEvent[]): { created: number; duplicates: number } {
  const cleaned = events.map((e) => ({ uid: e.uid, event: clean(e) }))
  const db = getDb()
  const known = new Set(
    (db.prepare('SELECT id, uid FROM events WHERE user_id = ?').all(userId) as { id: string; uid: string | null }[]).flatMap(
      (r) => [`${r.id}@noted`, ...(r.uid ? [r.uid] : [])],
    ),
  )
  const fresh = cleaned.filter(({ uid }) => {
    if (!uid) return true
    const own = NOTED_UID.exec(uid)
    if (known.has(uid) || (own && known.has(`${own[1]}@noted`))) return false
    known.add(uid)
    return true
  })
  checkQuota(userId, fresh.length)
  db.transaction(() => {
    for (const { uid, event } of fresh) insert(userId, event, uid)
  })()
  return { created: fresh.length, duplicates: events.length - fresh.length }
}

/** Alle Termine als .ics – für den Download und den ZIP-Export */
export function exportIcs(userId: number): string {
  const rows = getDb().prepare('SELECT * FROM events WHERE user_id = ? ORDER BY start_at').all(userId) as EventRow[]
  return toIcs(rows.map((r) => ({ ...toEvent(r), uid: r.uid })))
}

// ---------------------------------------------------------------------------
// Eingabeprüfung für die API – die Regeln im Einzelnen prüft eventError
// ---------------------------------------------------------------------------

const day = z.string().regex(DATE_RE)

export const eventSchema = z.object({
  title: z.string().max(MAX_TITLE * 2),
  location: z.string().max(MAX_LOCATION * 2),
  notes: z.string().max(MAX_NOTES * 2),
  color: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]).nullable(),
  allDay: z.boolean(),
  start: z.string().max(16),
  end: z.string().max(16),
  repeat: z.object({ weeks: z.number().int().min(1).max(MAX_REPEAT_WEEKS), until: day.nullable() }).nullable(),
  exdates: z.array(day).max(MAX_EXDATES),
  // Fehlt bei Geräten mit einer älteren Version der App
  exam: z
    .object({ deckIds: z.array(z.string().max(64)).max(MAX_EXAM_DECKS) })
    .nullable()
    .default(null),
})

export const occurrenceSchema = z.object({ date: day, event: eventSchema.nullable() })

export const importSchema = z.object({
  // Einzeltermine einer Serie hängen Datum bzw. Wochentag an die Kennung an
  events: z.array(eventSchema.extend({ uid: z.string().min(1).max(MAX_UID + 20).nullable() })).max(MAX_IMPORT_EVENTS),
})
