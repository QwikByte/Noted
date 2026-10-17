import 'server-only'
import { z } from 'zod'
import { getDb } from '@/shared/server/db'
import { badRequest, notFound } from '@/shared/server/http'
import { uuid } from '@/shared/server/crypto'
import { getDeadline, saveDeadline } from '@/features/calendar/server/events'
import { isValidDate, isValidDateTime } from '@/features/calendar/dates'
import { MAX_COURSE_NAME, MAX_COURSES, MAX_POINTS, MAX_SHEET_TITLE, MAX_SHEETS_PER_COURSE } from '../limits'
import type { Course, CourseInput, CourseworkData, Sheet, SheetInput } from '../types'

type CourseRow = {
  id: string
  user_id: number
  name: string
  required_percent: number
  planned_sheets: number | null
  created_at: number
  updated_at: number
}

type SheetRow = {
  id: string
  user_id: number
  course_id: string
  title: string
  max_points: number
  points: number | null
  event_id: string | null
  created_at: number
  updated_at: number
}

const toCourse = (r: CourseRow): Course => ({
  id: r.id,
  name: r.name,
  requiredPercent: r.required_percent,
  plannedSheets: r.planned_sheets,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

const toSheet = (r: SheetRow): Sheet => ({
  id: r.id,
  courseId: r.course_id,
  title: r.title,
  maxPoints: r.max_points,
  points: r.points,
  eventId: r.event_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

export function getCoursework(userId: number): CourseworkData {
  const db = getDb()
  const courses = db.prepare('SELECT * FROM courses WHERE user_id = ? ORDER BY name COLLATE NOCASE').all(userId) as CourseRow[]
  const sheets = db.prepare('SELECT * FROM exercise_sheets WHERE user_id = ? ORDER BY created_at').all(userId) as SheetRow[]
  return { courses: courses.map(toCourse), sheets: sheets.map(toSheet) }
}

function getCourseRow(userId: number, id: string): CourseRow {
  const row = getDb().prepare('SELECT * FROM courses WHERE id = ? AND user_id = ?').get(id, userId) as CourseRow | undefined
  if (!row) throw notFound('Fach nicht gefunden.')
  return row
}

function getSheetRow(userId: number, id: string): SheetRow {
  const row = getDb().prepare('SELECT * FROM exercise_sheets WHERE id = ? AND user_id = ?').get(id, userId) as SheetRow | undefined
  if (!row) throw notFound('Übungsblatt nicht gefunden.')
  return row
}

const cleanText = (text: string) => text.replace(/\s+/g, ' ').trim()

function cleanCourse(input: CourseInput): CourseInput {
  const name = cleanText(input.name)
  if (!name) throw badRequest('Bitte gib einen Namen ein.')
  if (name.length > MAX_COURSE_NAME) throw badRequest(`Der Name darf höchstens ${MAX_COURSE_NAME} Zeichen lang sein.`)
  return { ...input, name }
}

function cleanSheet(input: SheetInput): SheetInput {
  const title = cleanText(input.title)
  if (!title) throw badRequest('Bitte gib einen Titel ein.')
  if (title.length > MAX_SHEET_TITLE) throw badRequest(`Der Titel darf höchstens ${MAX_SHEET_TITLE} Zeichen lang sein.`)
  if (input.due !== null && !isValidDate(input.due) && !isValidDateTime(input.due)) throw badRequest('Bitte gib eine gültige Abgabe an.')
  return { ...input, title }
}

/** Titel des Abgabetermins im Kalender */
const deadlineTitle = (sheet: string, course: string) => `Abgabe ${sheet} – ${course}`

// ---------------------------------------------------------------------------
// Fächer
// ---------------------------------------------------------------------------

export function createCourse(userId: number, input: CourseInput): Course {
  const c = cleanCourse(input)
  const { n } = getDb().prepare('SELECT COUNT(*) AS n FROM courses WHERE user_id = ?').get(userId) as { n: number }
  if (n >= MAX_COURSES) throw badRequest(`Mehr als ${MAX_COURSES} Fächer sind nicht möglich.`)
  const id = uuid()
  const t = Date.now()
  getDb()
    .prepare(
      `INSERT INTO courses (id, user_id, name, required_percent, planned_sheets, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, userId, c.name, c.requiredPercent, c.plannedSheets, t, t)
  return toCourse(getCourseRow(userId, id))
}

/** Fach ändern – ein neuer Name kommt auch in die Abgabetermine */
export function updateCourse(userId: number, id: string, input: CourseInput): Course {
  const before = getCourseRow(userId, id)
  const c = cleanCourse(input)
  const db = getDb()
  db.transaction(() => {
    db.prepare(
      'UPDATE courses SET name = ?, required_percent = ?, planned_sheets = ?, updated_at = ? WHERE id = ? AND user_id = ?',
    ).run(c.name, c.requiredPercent, c.plannedSheets, Date.now(), id, userId)
    if (c.name === before.name) return
    const sheets = db
      .prepare('SELECT * FROM exercise_sheets WHERE course_id = ? AND user_id = ? AND event_id IS NOT NULL')
      .all(id, userId) as SheetRow[]
    for (const s of sheets) {
      const deadline = getDeadline(userId, s.event_id!)
      if (deadline) saveDeadline(userId, s.event_id, { ...deadline, title: deadlineTitle(s.title, c.name) })
    }
  })()
  return toCourse(getCourseRow(userId, id))
}

/** Fach mit allen Blättern und ihren Abgabeterminen löschen */
export function deleteCourse(userId: number, id: string) {
  getCourseRow(userId, id)
  const db = getDb()
  db.transaction(() => {
    const events = db
      .prepare('SELECT event_id FROM exercise_sheets WHERE course_id = ? AND user_id = ? AND event_id IS NOT NULL')
      .all(id, userId) as { event_id: string }[]
    for (const e of events) saveDeadline(userId, e.event_id, null)
    db.prepare('DELETE FROM courses WHERE id = ? AND user_id = ?').run(id, userId)
  })()
}

// ---------------------------------------------------------------------------
// Übungsblätter
// ---------------------------------------------------------------------------

export function createSheet(userId: number, courseId: string, input: SheetInput): Sheet {
  const course = getCourseRow(userId, courseId)
  const s = cleanSheet(input)
  const db = getDb()
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM exercise_sheets WHERE course_id = ? AND user_id = ?').get(courseId, userId) as {
    n: number
  }
  if (n >= MAX_SHEETS_PER_COURSE) throw badRequest(`Mehr als ${MAX_SHEETS_PER_COURSE} Blätter pro Fach sind nicht möglich.`)
  const id = uuid()
  const t = Date.now()
  db.transaction(() => {
    const eventId = s.due ? saveDeadline(userId, null, { title: deadlineTitle(s.title, course.name), due: s.due }) : null
    db.prepare(
      `INSERT INTO exercise_sheets (id, user_id, course_id, title, max_points, points, event_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, userId, courseId, s.title, s.maxPoints, s.points, eventId, t, t)
  })()
  return toSheet(getSheetRow(userId, id))
}

/** Blatt ändern – Abgabe und Titel gehen in den Termin; ohne Abgabe wird der Termin gelöscht */
export function updateSheet(userId: number, id: string, input: SheetInput): Sheet {
  const before = getSheetRow(userId, id)
  const course = getCourseRow(userId, before.course_id)
  const s = cleanSheet(input)
  const db = getDb()
  db.transaction(() => {
    const deadline = s.due ? { title: deadlineTitle(s.title, course.name), due: s.due } : null
    const eventId = saveDeadline(userId, before.event_id, deadline)
    db.prepare(
      'UPDATE exercise_sheets SET title = ?, max_points = ?, points = ?, event_id = ?, updated_at = ? WHERE id = ? AND user_id = ?',
    ).run(s.title, s.maxPoints, s.points, eventId, Date.now(), id, userId)
  })()
  return toSheet(getSheetRow(userId, id))
}

export function deleteSheet(userId: number, id: string) {
  const sheet = getSheetRow(userId, id)
  const db = getDb()
  db.transaction(() => {
    saveDeadline(userId, sheet.event_id, null)
    db.prepare('DELETE FROM exercise_sheets WHERE id = ? AND user_id = ?').run(id, userId)
  })()
}

// ---------------------------------------------------------------------------
// Eingabeprüfung für die API
// ---------------------------------------------------------------------------

const points = z.number().min(0).max(MAX_POINTS)

export const courseSchema = z.object({
  name: z.string().max(MAX_COURSE_NAME * 2),
  requiredPercent: z.number().min(0).max(100),
  plannedSheets: z.number().int().min(1).max(MAX_SHEETS_PER_COURSE).nullable(),
})

export const sheetSchema = z.object({
  title: z.string().max(MAX_SHEET_TITLE * 2),
  maxPoints: points.refine((n) => n > 0, 'Die erreichbaren Punkte müssen größer als 0 sein.'),
  points: points.nullable(),
  due: z.string().max(16).nullable(),
})
