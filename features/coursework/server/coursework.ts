import 'server-only'
import { z } from 'zod'
import { getDb } from '@/shared/server/db'
import { badRequest, notFound } from '@/shared/server/http'
import { uuid } from '@/shared/server/crypto'
import { getDeadline, saveDeadline } from '@/features/calendar/server/events'
import { DATE_RE, isValidDate, isValidDateTime } from '@/features/calendar/dates'
import {
  MAX_COURSE_NAME,
  MAX_COURSES,
  MAX_POINTS,
  MAX_SHEET_TITLE,
  MAX_SHEETS_PER_COURSE,
  MAX_TASK_TEXT,
  MAX_TASK_TITLE,
  MAX_TASKS_PER_COURSE,
} from '../limits'
import { taskDue } from '../tasks'
import type { Course, CourseInput, CourseTask, CourseworkData, Sheet, SheetInput, TaskInput, TaskResult } from '../types'

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

type TaskRow = {
  id: string
  user_id: number
  course_id: string
  title: string
  prompt: string
  solution: string
  result: TaskResult | null
  attempts: number
  due: string | null
  attempted_at: number | null
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

const toTask = (r: TaskRow): CourseTask => ({
  id: r.id,
  courseId: r.course_id,
  title: r.title,
  prompt: r.prompt,
  solution: r.solution,
  result: r.result,
  attempts: r.attempts,
  due: r.due,
  attemptedAt: r.attempted_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

export function getCoursework(userId: number): CourseworkData {
  const db = getDb()
  const courses = db.prepare('SELECT * FROM courses WHERE user_id = ? ORDER BY name COLLATE NOCASE').all(userId) as CourseRow[]
  const sheets = db.prepare('SELECT * FROM exercise_sheets WHERE user_id = ? ORDER BY created_at').all(userId) as SheetRow[]
  const tasks = db.prepare('SELECT * FROM course_tasks WHERE user_id = ? ORDER BY created_at').all(userId) as TaskRow[]
  return { courses: courses.map(toCourse), sheets: sheets.map(toSheet), tasks: tasks.map(toTask) }
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
// Aufgaben zum Wiederholen
// ---------------------------------------------------------------------------

function getTaskRow(userId: number, id: string): TaskRow {
  const row = getDb().prepare('SELECT * FROM course_tasks WHERE id = ? AND user_id = ?').get(id, userId) as TaskRow | undefined
  if (!row) throw notFound('Aufgabe nicht gefunden.')
  return row
}

function cleanTask(input: TaskInput): TaskInput {
  const title = cleanText(input.title)
  if (!title) throw badRequest('Bitte gib einen Titel ein.')
  if (title.length > MAX_TASK_TITLE) throw badRequest(`Der Titel darf höchstens ${MAX_TASK_TITLE} Zeichen lang sein.`)
  const prompt = input.prompt.trim()
  const solution = input.solution.trim()
  if (prompt.length > MAX_TASK_TEXT || solution.length > MAX_TASK_TEXT) throw badRequest('Der Text ist zu lang.')
  return { title, prompt, solution }
}

export function createTask(userId: number, courseId: string, input: TaskInput): CourseTask {
  getCourseRow(userId, courseId)
  const t = cleanTask(input)
  const db = getDb()
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM course_tasks WHERE course_id = ? AND user_id = ?').get(courseId, userId) as {
    n: number
  }
  if (n >= MAX_TASKS_PER_COURSE) throw badRequest(`Mehr als ${MAX_TASKS_PER_COURSE} Aufgaben pro Fach sind nicht möglich.`)
  const id = uuid()
  const now = Date.now()
  db.prepare(
    `INSERT INTO course_tasks (id, user_id, course_id, title, prompt, solution, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, courseId, t.title, t.prompt, t.solution, now, now)
  return toTask(getTaskRow(userId, id))
}

export function updateTask(userId: number, id: string, input: TaskInput): CourseTask {
  getTaskRow(userId, id)
  const t = cleanTask(input)
  getDb()
    .prepare('UPDATE course_tasks SET title = ?, prompt = ?, solution = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(t.title, t.prompt, t.solution, Date.now(), id, userId)
  return toTask(getTaskRow(userId, id))
}

export function deleteTask(userId: number, id: string) {
  getTaskRow(userId, id)
  getDb().prepare('DELETE FROM course_tasks WHERE id = ? AND user_id = ?').run(id, userId)
}

/** Ergebnis einer Bearbeitung festhalten – `today` (Ortszeit des Geräts) bestimmt den Tag der nächsten Wiederholung */
export function recordAttempt(userId: number, id: string, result: TaskResult, today: string): CourseTask {
  getTaskRow(userId, id)
  if (!isValidDate(today)) throw badRequest('Ungültiger Tag.')
  getDb()
    .prepare(
      `UPDATE course_tasks SET result = ?, due = ?, attempts = attempts + 1, attempted_at = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
    .run(result, taskDue(result, today), Date.now(), Date.now(), id, userId)
  return toTask(getTaskRow(userId, id))
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

export const taskSchema = z.object({
  title: z.string().max(MAX_TASK_TITLE * 2),
  prompt: z.string().max(MAX_TASK_TEXT * 2),
  solution: z.string().max(MAX_TASK_TEXT * 2),
})

export const attemptSchema = z.object({
  result: z.enum(['solved', 'unsure', 'wrong']),
  today: z.string().regex(DATE_RE),
})
