import 'server-only'
import { z } from 'zod'
import { getDb } from '@/shared/server/db'
import { badRequest, notFound } from '@/shared/server/http'
import { uuid } from '@/shared/server/crypto'
import { addDays, DATE_RE } from '../dates'
import { eventError, occurrences } from '../event'
import { toIcs } from '../ics'
import { MAX_EXDATES, MAX_IMPORT_EVENTS, MAX_LOCATION, MAX_NOTES, MAX_REPEAT_WEEKS, MAX_TITLE, MAX_UID } from '../limits'
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

const toEvent = (r: EventRow): CalendarEvent => ({
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
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

function getRow(userId: number, id: string): EventRow {
  const row = getDb().prepare('SELECT * FROM events WHERE id = ? AND user_id = ?').get(id, userId) as EventRow | undefined
  if (!row) throw notFound('Termin nicht gefunden.')
  return row
}

/** Eingabe vereinheitlichen und prüfen – Ausnahmen gibt es nur bei Serien */
function clean(input: EventInput): EventInput {
  const e: EventInput = {
    ...input,
    title: input.title.replace(/\s+/g, ' ').trim(),
    location: input.location.trim(),
    notes: input.notes.trim(),
    exdates: input.repeat ? [...new Set(input.exdates)].sort() : [],
  }
  const error = eventError(e)
  if (error) throw badRequest(error)
  return e
}

function checkQuota(userId: number, adding: number) {
  const { n } = getDb().prepare('SELECT COUNT(*) AS n FROM events WHERE user_id = ?').get(userId) as { n: number }
  if (n + adding > MAX_EVENTS_PER_USER) throw badRequest(`Mehr als ${MAX_EVENTS_PER_USER} Termine sind nicht möglich.`)
}

function insert(userId: number, e: EventInput, uid: string | null = null): string {
  const id = uuid()
  const t = Date.now()
  getDb()
    .prepare(
      `INSERT INTO events (id, user_id, title, location, notes, color, all_day, start_at, end_at, repeat_weeks, repeat_until,
         exdates, uid, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      uid,
      t,
      t,
    )
  return id
}

export function listEvents(userId: number): CalendarEvent[] {
  const rows = getDb().prepare('SELECT * FROM events WHERE user_id = ? ORDER BY start_at').all(userId) as EventRow[]
  return rows.map(toEvent)
}

export function createEvent(userId: number, input: EventInput): CalendarEvent {
  const e = clean(input)
  checkQuota(userId, 1)
  return toEvent(getRow(userId, insert(userId, e)))
}

/** Termin bzw. ganze Serie ändern */
export function updateEvent(userId: number, id: string, input: EventInput): CalendarEvent {
  getRow(userId, id)
  const e = clean(input)
  getDb()
    .prepare(
      `UPDATE events SET title = ?, location = ?, notes = ?, color = ?, all_day = ?, start_at = ?, end_at = ?,
         repeat_weeks = ?, repeat_until = ?, exdates = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
    )
    .run(
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
      Date.now(),
      id,
      userId,
    )
  return toEvent(getRow(userId, id))
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
  const series = toEvent(getRow(userId, id))
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
  return { series: toEvent(getRow(userId, id)), event: eventId ? toEvent(getRow(userId, eventId)) : null }
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

/** Alle Termine als .ics – für den Download und den Vault-Export */
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
})

export const occurrenceSchema = z.object({ date: day, event: eventSchema.nullable() })

export const importSchema = z.object({
  // Einzeltermine einer Serie hängen Datum bzw. Wochentag an die Kennung an
  events: z.array(eventSchema.extend({ uid: z.string().min(1).max(MAX_UID + 20).nullable() })).max(MAX_IMPORT_EVENTS),
})
