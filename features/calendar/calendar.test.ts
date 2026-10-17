import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ADMIN_PASSWORD, call, loginAs, setupTestEnv } from '@/tests/helpers'
import * as calendar from '@/app/api/calendar/route'
import * as eventRoute from '@/app/api/calendar/[id]/route'
import * as occurrence from '@/app/api/calendar/[id]/occurrence/route'
import * as importRoute from '@/app/api/calendar/import/route'
import * as exportRoute from '@/app/api/calendar/export/route'
import * as users from '@/app/api/admin/users/route'
import * as password from '@/app/api/account/password/route'
import * as decks from '@/app/api/decks/route'
import * as deckRoute from '@/app/api/decks/[id]/route'
import { getDb } from '@/shared/server/db'
import { parseIcs } from './ics'
import { occurrences } from './event'
import type { CalendarEvent, EventInput } from './types'

let env: Awaited<ReturnType<typeof setupTestEnv>>
let token = ''

beforeAll(async () => {
  env = await setupTestEnv()
  token = await loginAs('admin', ADMIN_PASSWORD)
})
afterAll(() => env.cleanup())
beforeEach(() => {
  getDb().prepare('DELETE FROM events').run()
})

const lecture: EventInput = {
  title: 'Analysis I',
  location: 'Hörsaal 1',
  notes: '',
  color: 2,
  allDay: false,
  start: '2026-10-19T10:15',
  end: '2026-10-19T11:45',
  repeat: { weeks: 1, until: '2027-02-08' },
  exdates: [],
  exam: null,
}

async function create(input: EventInput, cookie = token) {
  const r = await call(calendar.POST, '/api/calendar', { cookie, body: input })
  expect(r.status).toBe(201)
  return r.data.event as CalendarEvent
}

async function list(cookie = token) {
  const r = await call(calendar.GET, '/api/calendar', { cookie })
  expect(r.status).toBe(200)
  return r.data.events as CalendarEvent[]
}

describe('Termine', () => {
  it('legt Termine an, ändert und löscht sie', async () => {
    const e = await create({ ...lecture, title: '  Analysis   I ', exdates: ['2026-11-02', '2026-10-26', '2026-11-02'] })
    expect(e).toMatchObject({ ...lecture, exdates: ['2026-10-26', '2026-11-02'] })
    expect(await list()).toEqual([e])

    const put = await call(eventRoute.PUT, '/', {
      method: 'PUT',
      cookie: token,
      params: { id: e.id },
      body: { ...lecture, title: 'Analysis II', repeat: null, exdates: ['2026-10-26'] },
    })
    expect(put.status).toBe(200)
    // Ohne Wiederholung gibt es keine Ausnahmen
    expect(put.data.event).toMatchObject({ title: 'Analysis II', repeat: null, exdates: [], createdAt: e.createdAt })

    expect((await call(eventRoute.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: e.id } })).status).toBe(200)
    expect(await list()).toEqual([])
    expect((await call(eventRoute.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: e.id } })).status).toBe(404)
  })

  it('weist ungültige Termine mit verständlicher Meldung ab', async () => {
    const bad = await call(calendar.POST, '/api/calendar', { cookie: token, body: { ...lecture, end: '2026-10-19T09:00' } })
    expect(bad.status).toBe(400)
    expect(bad.data.message).toBe('Das Ende liegt vor dem Beginn.')
    const shape = await call(calendar.POST, '/api/calendar', { cookie: token, body: { ...lecture, color: 9 } })
    expect(shape.status).toBe(400)
    const missing = await call(calendar.POST, '/api/calendar', { cookie: token, body: { title: 'x' } })
    expect(missing.status).toBe(400)
    expect(await list()).toEqual([])
  })

  it('ist ohne Anmeldung und ohne CSRF-Header nicht nutzbar', async () => {
    expect((await call(calendar.GET, '/api/calendar')).status).toBe(401)
    expect((await call(calendar.POST, '/api/calendar', { cookie: token, body: lecture, csrf: false })).status).toBe(403)
  })

  it('zeigt jedem nur die eigenen Termine', async () => {
    const mine = await create(lecture)
    expect((await call(users.POST, '/api/admin/users', { cookie: token, body: { username: 'ben', password: 'Ben-Passwort-1234' } })).status).toBe(201)
    const ben = await loginAs('ben', 'Ben-Passwort-1234')
    await call(password.POST, '/', { cookie: ben, body: { currentPassword: 'Ben-Passwort-1234', newPassword: 'Ben-Passwort-5678' } })

    expect(await list(ben)).toEqual([])
    const put = await call(eventRoute.PUT, '/', { method: 'PUT', cookie: ben, params: { id: mine.id }, body: lecture })
    expect(put.status).toBe(404)
    expect((await call(eventRoute.DELETE, '/', { method: 'DELETE', cookie: ben, params: { id: mine.id } })).status).toBe(404)
    const split = await call(occurrence.POST, '/', { cookie: ben, params: { id: mine.id }, body: { date: '2026-10-26', event: null } })
    expect(split.status).toBe(404)
    const exported = await call(exportRoute.GET, '/api/calendar/export', { cookie: ben })
    expect(await exported.res.text()).not.toContain('Analysis')
    expect(await list()).toEqual([mine])
  })
})

describe('Einzelne Termine einer Serie', () => {
  it('lässt einen Termin ausfallen', async () => {
    const series = await create(lecture)
    const r = await call(occurrence.POST, '/', { cookie: token, params: { id: series.id }, body: { date: '2026-10-26', event: null } })
    expect(r.status).toBe(200)
    expect(r.data.event).toBeNull()
    expect(r.data.series.exdates).toEqual(['2026-10-26'])
    expect(occurrences(await list(), '2026-10-19', '2026-11-03').map((o) => o.start)).toEqual([
      '2026-10-19T10:15',
      '2026-11-02T10:15',
    ])
  })

  it('verschiebt nur einen Termin und lässt die Serie sonst unverändert', async () => {
    const series = await create(lecture)
    const moved = { ...lecture, location: 'Raum 5', start: '2026-10-27T14:00', end: '2026-10-27T15:30' }
    const r = await call(occurrence.POST, '/', { cookie: token, params: { id: series.id }, body: { date: '2026-10-26', event: moved } })
    expect(r.status).toBe(200)
    expect(r.data.event).toMatchObject({ ...moved, repeat: null, exdates: [] })
    expect(occurrences(await list(), '2026-10-19', '2026-11-03').map((o) => `${o.start} ${o.event.location}`)).toEqual([
      '2026-10-19T10:15 Hörsaal 1',
      '2026-10-27T14:00 Raum 5',
      '2026-11-02T10:15 Hörsaal 1',
    ])
  })

  it('nimmt nur Tage an, an denen die Serie stattfindet', async () => {
    const series = await create(lecture)
    const single = await create({ ...lecture, repeat: null })
    const wrongDay = await call(occurrence.POST, '/', { cookie: token, params: { id: series.id }, body: { date: '2026-10-27', event: null } })
    expect(wrongDay.status).toBe(400)
    expect(wrongDay.data.message).toBe('Diesen Termin gibt es in der Serie nicht.')
    const afterEnd = await call(occurrence.POST, '/', { cookie: token, params: { id: series.id }, body: { date: '2027-02-15', event: null } })
    expect(afterEnd.status).toBe(400)
    await call(occurrence.POST, '/', { cookie: token, params: { id: series.id }, body: { date: '2026-10-26', event: null } })
    const twice = await call(occurrence.POST, '/', { cookie: token, params: { id: series.id }, body: { date: '2026-10-26', event: null } })
    expect(twice.status).toBe(400)
    const noSeries = await call(occurrence.POST, '/', { cookie: token, params: { id: single.id }, body: { date: '2026-10-19', event: null } })
    expect(noSeries.status).toBe(400)
    const invalid = await call(occurrence.POST, '/', {
      cookie: token,
      params: { id: series.id },
      body: { date: '2026-11-02', event: { ...lecture, title: '' } },
    })
    expect(invalid.status).toBe(400)
    // Ein abgelehnter Einzeltermin lässt die Serie unverändert
    expect((await list()).find((e) => e.id === series.id)?.exdates).toEqual(['2026-10-26'])
  })
})

describe('.ics-Import und -Export', () => {
  const ICS = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:vl-1@uni.example',
    'SUMMARY:Lineare Algebra',
    'DTSTART;TZID=Europe/Berlin:20261020T081500',
    'DTEND;TZID=Europe/Berlin:20261020T094500',
    'RRULE:FREQ=WEEKLY;UNTIL=20270209T071500Z',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:feiertag@uni.example',
    'SUMMARY:Reformationstag',
    'DTSTART;VALUE=DATE:20261031',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')

  const importIcs = (text: string, cookie = token) =>
    call(importRoute.POST, '/api/calendar/import', { cookie, body: { events: parseIcs(text, 'Europe/Berlin').events } })

  it('übernimmt Termine und legt sie beim zweiten Import nicht doppelt an', async () => {
    const first = await importIcs(ICS)
    expect(first.data).toEqual({ created: 2, duplicates: 0 })
    expect((await list()).map((e) => [e.title, e.start, e.repeat])).toEqual([
      ['Lineare Algebra', '2026-10-20T08:15', { weeks: 1, until: '2027-02-09' }],
      ['Reformationstag', '2026-10-31', null],
    ])
    expect((await importIcs(ICS)).data).toEqual({ created: 0, duplicates: 2 })
    expect(await list()).toHaveLength(2)
  })

  it('exportiert alle Termine als .ics, die sich ohne Doppelte wieder einlesen lässt', async () => {
    await importIcs(ICS)
    const own = await create({ ...lecture, notes: 'Skript; Kapitel 1, 2' })
    await call(occurrence.POST, '/', { cookie: token, params: { id: own.id }, body: { date: '2026-10-26', event: null } })

    const r = await call(exportRoute.GET, '/api/calendar/export', { cookie: token })
    expect(r.status).toBe(200)
    expect(r.res.headers.get('content-type')).toBe('text/calendar; charset=utf-8')
    expect(r.res.headers.get('content-disposition')).toBe('attachment; filename="Kalender.ics"')
    const text = await r.res.text()
    // Importierte Termine behalten ihre Kennung, eigene bekommen eine von Noted
    expect(text).toContain('UID:vl-1@uni.example')
    expect(text).toContain(`UID:${own.id}@noted`)
    expect(text).toContain('EXDATE:20261026T101500')
    expect(text).toContain('DESCRIPTION:Skript\\; Kapitel 1\\, 2')

    expect((await importIcs(text)).data).toEqual({ created: 0, duplicates: 3 })
    // Nach dem Löschen kommt alles unverändert zurück
    getDb().prepare('DELETE FROM events').run()
    expect((await importIcs(text)).data).toEqual({ created: 3, duplicates: 0 })
    expect((await list()).find((e) => e.title === 'Analysis I')).toMatchObject({ ...lecture, notes: 'Skript; Kapitel 1, 2', exdates: ['2026-10-26'] })
  })

  it('weist ungültige Termine im Import ab, ohne etwas anzulegen', async () => {
    const r = await call(importRoute.POST, '/api/calendar/import', {
      cookie: token,
      body: { events: [{ ...lecture, uid: 'a' }, { ...lecture, uid: 'b', start: '2026-02-30T10:00' }] },
    })
    expect(r.status).toBe(400)
    expect(await list()).toEqual([])
  })
})

describe('Klausuren', () => {
  const exam: EventInput = {
    ...lecture,
    title: 'Klausur Analysis I',
    start: '2027-02-15T09:00',
    end: '2027-02-15T11:00',
    repeat: null,
    exam: { deckIds: [] },
  }

  async function deck(name: string, cookie = token) {
    const r = await call(decks.POST, '/api/decks', { cookie, body: { name } })
    expect(r.status).toBe(201)
    return r.data.deck.id as string
  }

  const put = (id: string, body: EventInput) => call(eventRoute.PUT, '/', { method: 'PUT', cookie: token, params: { id }, body })
  const links = () => (getDb().prepare('SELECT COUNT(*) AS n FROM exam_decks').get() as { n: number }).n

  it('verknüpft nur eigene Stapel und löst die Verknüpfung mit Stapel, Klausur oder Termin wieder', async () => {
    const analysis = await deck('Analysis I')
    const algebra = await deck('Lineare Algebra I')
    expect((await call(users.POST, '/api/admin/users', { cookie: token, body: { username: 'carla', password: 'Geheimes-Wort-12' } })).status).toBe(201)
    const carla = await loginAs('carla', 'Geheimes-Wort-12')
    await call(password.POST, '/', { cookie: carla, body: { currentPassword: 'Geheimes-Wort-12', newPassword: 'Geheimes-Wort-34' } })
    const foreign = await deck('Fremder Stapel', carla)

    const e = await create({ ...exam, exam: { deckIds: [analysis, algebra, analysis, foreign, 'gibt-es-nicht'] } })
    expect(e.exam?.deckIds.toSorted()).toEqual([analysis, algebra].toSorted())
    expect(await list()).toEqual([e])

    // Gelöschter Stapel fällt aus der Klausur
    expect((await call(deckRoute.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: algebra } })).status).toBe(200)
    expect((await list())[0].exam).toEqual({ deckIds: [analysis] })

    // Keine Klausur mehr – und wieder eine
    expect((await put(e.id, { ...exam, exam: null })).data.event.exam).toBeNull()
    expect(links()).toBe(0)
    expect((await put(e.id, { ...exam, exam: { deckIds: [analysis] } })).data.event.exam).toEqual({ deckIds: [analysis] })

    // Ein fremder Termin lässt sich nicht zur Klausur machen
    expect((await call(eventRoute.PUT, '/', { method: 'PUT', cookie: carla, params: { id: e.id }, body: exam })).status).toBe(404)

    expect((await call(eventRoute.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: e.id } })).status).toBe(200)
    expect(links()).toBe(0)
    await call(deckRoute.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: analysis } })
  })

  it('lässt Klausuren sich nicht wiederholen und nimmt Termine älterer App-Versionen ohne Angabe an', async () => {
    const series = await call(calendar.POST, '/api/calendar', { cookie: token, body: { ...lecture, exam: { deckIds: [] } } })
    expect(series.status).toBe(400)
    expect(series.data.message).toBe('Eine Klausur kann sich nicht wiederholen.')

    const old: Partial<EventInput> = { ...lecture }
    delete old.exam
    const r = await call(calendar.POST, '/api/calendar', { cookie: token, body: old })
    expect(r.status).toBe(201)
    expect(r.data.event.exam).toBeNull()
  })

  it('macht aus dem geänderten Termin einer Serie auf Wunsch eine Klausur', async () => {
    const d = await deck('Numerik')
    const s = await create(lecture)
    const r = await call(occurrence.POST, '/', {
      cookie: token,
      params: { id: s.id },
      body: { date: '2026-10-26', event: { ...lecture, start: '2026-10-26T10:15', end: '2026-10-26T11:45', repeat: null, exam: { deckIds: [d] } } },
    })
    expect(r.status).toBe(200)
    expect(r.data.event.exam).toEqual({ deckIds: [d] })
    expect(r.data.series.exam).toBeNull()
    await call(deckRoute.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: d } })
  })
})
