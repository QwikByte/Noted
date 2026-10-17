import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ADMIN_PASSWORD, call, loginAs, setupTestEnv } from '@/tests/helpers'
import * as coursework from '@/app/api/coursework/route'
import * as courses from '@/app/api/coursework/courses/route'
import * as courseRoute from '@/app/api/coursework/courses/[id]/route'
import * as sheets from '@/app/api/coursework/courses/[id]/sheets/route'
import * as sheetRoute from '@/app/api/coursework/sheets/[id]/route'
import * as calendar from '@/app/api/calendar/route'
import * as eventRoute from '@/app/api/calendar/[id]/route'
import * as users from '@/app/api/admin/users/route'
import * as password from '@/app/api/account/password/route'
import type { CalendarEvent } from '@/features/calendar/types'
import type { Course, CourseworkData, Sheet, SheetInput } from './types'

let env: Awaited<ReturnType<typeof setupTestEnv>>
let token = ''

beforeAll(async () => {
  env = await setupTestEnv()
  token = await loginAs('admin', ADMIN_PASSWORD)
})
afterAll(() => env.cleanup())

async function createCourse(name: string, cookie = token) {
  const r = await call(courses.POST, '/', { cookie, body: { name, requiredPercent: 50, plannedSheets: 12 } })
  expect(r.status).toBe(201)
  return r.data.course as Course
}

async function createSheet(courseId: string, input: SheetInput) {
  const r = await call(sheets.POST, '/', { cookie: token, params: { id: courseId }, body: input })
  expect(r.status).toBe(201)
  return r.data.sheet as Sheet
}

const putSheet = (id: string, body: SheetInput, cookie = token) => call(sheetRoute.PUT, '/', { method: 'PUT', cookie, params: { id }, body })
const load = async (cookie = token) => (await call(coursework.GET, '/', { cookie })).data as CourseworkData
const events = async () => (await call(calendar.GET, '/', { cookie: token })).data.events as CalendarEvent[]

describe('Übungen', () => {
  it('legt Fächer und Blätter an – die Abgabe steht als Termin im Kalender', async () => {
    const course = await createCourse('  Analysis   I ')
    expect(course).toMatchObject({ name: 'Analysis I', requiredPercent: 50, plannedSheets: 12 })

    const sheet = await createSheet(course.id, { title: 'Blatt 1', maxPoints: 20, points: null, due: '2026-10-27T12:00' })
    expect(sheet).toMatchObject({ courseId: course.id, title: 'Blatt 1', maxPoints: 20, points: null })
    const [event] = await events()
    expect(event).toMatchObject({ id: sheet.eventId, title: 'Abgabe Blatt 1 – Analysis I', start: '2026-10-27T12:00', end: '2026-10-27T12:00' })

    // Punkte eintragen, Abgabe auf einen ganzen Tag verschieben
    const graded = await putSheet(sheet.id, { title: 'Blatt 1', maxPoints: 20, points: 13.5, due: '2026-10-28' })
    expect(graded.data.sheet).toMatchObject({ points: 13.5, eventId: sheet.eventId })
    expect((await events())[0]).toMatchObject({ allDay: true, start: '2026-10-28', end: '2026-10-29' })

    // Ein neuer Name des Fachs kommt in den Termin
    const renamed = await call(courseRoute.PUT, '/', {
      method: 'PUT',
      cookie: token,
      params: { id: course.id },
      body: { name: 'Analysis 1', requiredPercent: 60, plannedSheets: null },
    })
    expect(renamed.data.course).toMatchObject({ name: 'Analysis 1', requiredPercent: 60, plannedSheets: null })
    expect((await events())[0].title).toBe('Abgabe Blatt 1 – Analysis 1')

    // Ohne Abgabe verschwindet der Termin
    expect((await putSheet(sheet.id, { title: 'Blatt 1', maxPoints: 20, points: 13.5, due: null })).data.sheet.eventId).toBeNull()
    expect(await events()).toEqual([])

    const data = await load()
    expect(data.courses).toEqual([expect.objectContaining({ id: course.id })])
    expect(data.sheets).toEqual([expect.objectContaining({ id: sheet.id, points: 13.5 })])
    await call(courseRoute.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: course.id } })
  })

  it('räumt Abgabetermine mit Blatt und Fach ab – und umgekehrt', async () => {
    const course = await createCourse('Lineare Algebra I')
    const one = await createSheet(course.id, { title: 'Blatt 1', maxPoints: 10, points: null, due: '2026-11-02T10:00' })
    const two = await createSheet(course.id, { title: 'Blatt 2', maxPoints: 10, points: null, due: '2026-11-09T10:00' })
    await createSheet(course.id, { title: 'Blatt 3', maxPoints: 10, points: null, due: '2026-11-16T10:00' })
    expect(await events()).toHaveLength(3)

    expect((await call(sheetRoute.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: one.id } })).status).toBe(200)
    expect((await events()).map((e) => e.title)).toEqual(['Abgabe Blatt 2 – Lineare Algebra I', 'Abgabe Blatt 3 – Lineare Algebra I'])

    // Im Kalender gelöscht: Das Blatt hat keine Abgabe mehr
    await call(eventRoute.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: two.eventId ?? '' } })
    expect((await load()).sheets.find((s) => s.id === two.id)?.eventId).toBeNull()

    expect((await call(courseRoute.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: course.id } })).status).toBe(200)
    expect(await events()).toEqual([])
    expect(await load()).toEqual({ courses: [], sheets: [] })
  })

  it('prüft Eingaben und zeigt jedem nur die eigenen Fächer', async () => {
    const course = await createCourse('Numerik')
    const bad = async (input: Partial<SheetInput>) =>
      (await call(sheets.POST, '/', { cookie: token, params: { id: course.id }, body: { title: 'Blatt', maxPoints: 10, points: null, due: null, ...input } }))
        .status
    expect(await bad({ title: '  ' })).toBe(400)
    expect(await bad({ maxPoints: 0 })).toBe(400)
    expect(await bad({ points: -1 })).toBe(400)
    expect(await bad({ due: '2026-02-30' })).toBe(400)
    expect(await bad({ due: '2026-10-27T25:00' })).toBe(400)
    expect((await call(courses.POST, '/', { cookie: token, body: { name: 'x', requiredPercent: 120, plannedSheets: null } })).status).toBe(400)

    expect((await call(users.POST, '/api/admin/users', { cookie: token, body: { username: 'dora', password: 'Geheimes-Wort-56' } })).status).toBe(201)
    const dora = await loginAs('dora', 'Geheimes-Wort-56')
    await call(password.POST, '/', { cookie: dora, body: { currentPassword: 'Geheimes-Wort-56', newPassword: 'Geheimes-Wort-78' } })
    const sheet = await createSheet(course.id, { title: 'Blatt 1', maxPoints: 10, points: null, due: null })

    expect(await load(dora)).toEqual({ courses: [], sheets: [] })
    expect((await call(sheets.POST, '/', { cookie: dora, params: { id: course.id }, body: { title: 'x', maxPoints: 1, points: null, due: null } })).status).toBe(404)
    expect((await putSheet(sheet.id, { title: 'x', maxPoints: 1, points: 1, due: null }, dora)).status).toBe(404)
    expect((await call(courseRoute.DELETE, '/', { method: 'DELETE', cookie: dora, params: { id: course.id } })).status).toBe(404)
    expect((await call(coursework.GET, '/')).status).toBe(401)
    expect((await call(courses.POST, '/', { cookie: token, body: { name: 'x', requiredPercent: 50, plannedSheets: null }, csrf: false })).status).toBe(403)
  })
})
