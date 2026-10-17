import { describe, expect, it } from 'vitest'
import { dayLabel, endedToday, focusMinutes, groupByDay, noteTitleFor, timeLabel } from './agenda'
import { addDays, addMonths, isoWeek, isValidDate, isValidDateTime, minutesBetween, startOfWeek, weekday } from './dates'
import { applyToSeries, blankEvent, eventError, occurrences, onDay } from './event'
import { layoutDay } from './layout'
import type { CalendarEvent, EventInput } from './types'

// Gerechnet wird ohne Zeitzone – die Tests gelten daher überall gleich
function ev(title: string, start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: title,
    title,
    location: '',
    notes: '',
    color: null,
    allDay: start.length === 10,
    start,
    end,
    repeat: null,
    exdates: [],
    exam: null,
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  }
}

const dates = (events: CalendarEvent[], first: string, last: string) =>
  occurrences(events, first, last).map((o) => `${o.event.title} ${o.start}`)

describe('Datum', () => {
  it('rechnet mit Tagen, Wochen und Monaten', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(weekday('2026-10-19')).toBe(0)
    expect(weekday('2026-10-25')).toBe(6)
    expect(startOfWeek('2026-10-25')).toBe('2026-10-19')
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-01')
    expect(addMonths('2026-01-31', -1)).toBe('2025-12-01')
  })

  it('zählt Kalenderwochen nach ISO 8601', () => {
    expect(isoWeek('2026-10-19')).toBe(43)
    expect(isoWeek('2026-01-01')).toBe(1)
    // Der 1.1.2027 ist ein Freitag – er gehört noch zur letzten Woche 2026
    expect(isoWeek('2027-01-01')).toBe(53)
    expect(isoWeek('2027-01-04')).toBe(1)
  })

  it('bleibt über die Zeitumstellung bei der Uhrzeit', () => {
    // Nacht vom 24. auf den 25.10.2026: In Mitteleuropa wird die Uhr zurückgestellt
    expect(minutesBetween('2026-10-24T10:00', '2026-10-25T10:00')).toBe(1440)
  })

  it('erkennt ungültige Tage und Uhrzeiten', () => {
    expect(isValidDate('2026-02-29')).toBe(false)
    expect(isValidDate('2028-02-29')).toBe(true)
    expect(isValidDateTime('2026-10-19T24:00')).toBe(false)
    expect(isValidDateTime('2026-10-19 10:00')).toBe(false)
    expect(isValidDateTime('2026-10-19T23:59')).toBe(true)
  })
})

describe('Termine prüfen', () => {
  const base: EventInput = {
    title: 'Vorlesung',
    location: '',
    notes: '',
    color: null,
    allDay: false,
    start: '2026-10-19T10:15',
    end: '2026-10-19T11:45',
    repeat: null,
    exdates: [],
    exam: null,
  }

  it('nimmt gültige Termine an', () => {
    expect(eventError(base)).toBeNull()
    expect(eventError({ ...base, allDay: true, start: '2026-10-19', end: '2026-10-20' })).toBeNull()
    expect(eventError({ ...base, repeat: { weeks: 1, until: '2026-10-19' } })).toBeNull()
  })

  it('weist ungültige Termine mit verständlicher Meldung ab', () => {
    expect(eventError({ ...base, title: '  ' })).toBe('Bitte gib einen Titel ein.')
    expect(eventError({ ...base, end: '2026-10-19T10:00' })).toBe('Das Ende liegt vor dem Beginn.')
    expect(eventError({ ...base, allDay: true, start: '2026-10-19', end: '2026-10-19' })).toBe('Der letzte Tag liegt vor dem ersten.')
    expect(eventError({ ...base, allDay: true })).toBe('Bitte gib gültige Tage an.')
    expect(eventError({ ...base, start: '2026-02-30T10:00' })).toBe('Bitte gib gültige Zeiten an.')
    expect(eventError({ ...base, repeat: { weeks: 0, until: null } })).toBe('Ungültige Wiederholung.')
    expect(eventError({ ...base, repeat: { weeks: 53, until: null } })).toBe('Ungültige Wiederholung.')
    expect(eventError({ ...base, repeat: { weeks: 1, until: '2026-10-18' } })).toBe(
      'Die Wiederholung endet vor dem ersten Termin.',
    )
    expect(eventError({ ...base, exdates: ['19.10.2026'] })).toBe('Ungültige Ausnahmen.')
    expect(eventError({ ...base, title: 'x'.repeat(301) })).toBe('Der Text ist zu lang.')
  })
})

describe('Wiederholungen', () => {
  const lecture = ev('Analysis', '2026-10-19T10:15', '2026-10-19T11:45', {
    repeat: { weeks: 1, until: '2026-11-09' },
    exdates: ['2026-11-02'],
  })

  it('wiederholt wöchentlich bis zum letzten Tag, ohne ausfallende Termine', () => {
    expect(dates([lecture], '2026-10-01', '2026-12-31')).toEqual([
      'Analysis 2026-10-19T10:15',
      'Analysis 2026-10-26T10:15',
      'Analysis 2026-11-09T10:15',
    ])
    expect(dates([lecture], '2026-10-27', '2026-11-09')).toEqual([])
  })

  it('alle zwei Wochen und ohne Ende', () => {
    const lab = ev('Labor', '2026-10-21T14:00', '2026-10-21T16:00', { repeat: { weeks: 2, until: null } })
    expect(dates([lab], '2026-10-19', '2026-11-19')).toEqual([
      'Labor 2026-10-21T14:00',
      'Labor 2026-11-04T14:00',
      'Labor 2026-11-18T14:00',
    ])
    // Weit in der Zukunft – ohne alle Wochen davor durchzugehen
    expect(dates([lab], '2036-10-20', '2036-10-27')).toEqual(['Labor 2036-10-22T14:00'])
  })

  it('findet Termine über Mitternacht, die am Vortag beginnen', () => {
    const night = ev('Nachtschicht', '2026-10-18T22:00', '2026-10-19T02:00', { repeat: { weeks: 1, until: null } })
    expect(dates([night], '2026-10-26', '2026-10-27')).toEqual(['Nachtschicht 2026-10-25T22:00'])
    const [o] = occurrences([night], '2026-10-26', '2026-10-27')
    expect(o.date).toBe('2026-10-25')
    expect(o.end).toBe('2026-10-26T02:00')
  })

  it('wiederholt mehrtägige ganztägige Termine', () => {
    const block = ev('Blockseminar', '2026-10-23', '2026-10-25', { repeat: { weeks: 1, until: '2026-10-30' } })
    expect(dates([block], '2026-10-24', '2026-10-31')).toEqual(['Blockseminar 2026-10-23', 'Blockseminar 2026-10-30'])
    expect(occurrences([block], '2026-10-30', '2026-10-31')[0].end).toBe('2026-11-01')
  })

  it('sortiert nach Beginn, ganztägige zuerst', () => {
    const events = [
      ev('B', '2026-10-19T12:00', '2026-10-19T13:00'),
      ev('A', '2026-10-19T08:00', '2026-10-19T09:00'),
      ev('Feiertag', '2026-10-19', '2026-10-20'),
    ]
    expect(dates(events, '2026-10-19', '2026-10-20')).toEqual(['Feiertag 2026-10-19', 'A 2026-10-19T08:00', 'B 2026-10-19T12:00'])
  })

  it('Termine ohne Dauer zählen an ihrem Tag, Ende um Mitternacht nicht am Folgetag', () => {
    const deadline = ev('Abgabe', '2026-10-20T00:00', '2026-10-20T00:00')
    expect(dates([deadline], '2026-10-20', '2026-10-21')).toHaveLength(1)
    expect(dates([deadline], '2026-10-19', '2026-10-20')).toHaveLength(0)
    const [late] = occurrences([ev('Party', '2026-10-24T20:00', '2026-10-25T00:00')], '2026-10-24', '2026-10-26')
    expect(onDay(late, '2026-10-24')).toBe(true)
    expect(onDay(late, '2026-10-25')).toBe(false)
  })
})

describe('Serie ändern', () => {
  const series = ev('Analysis', '2026-10-19T10:15', '2026-10-19T11:45', {
    repeat: { weeks: 1, until: '2027-02-08' },
    exdates: ['2026-11-02'],
  })
  const [, second] = occurrences([series], '2026-10-19', '2026-11-01')

  it('überträgt eine neue Uhrzeit und Dauer auf alle Termine', () => {
    const edited = { ...series, title: 'Analysis I', start: '2026-10-26T12:00', end: '2026-10-26T14:00' }
    expect(applyToSeries(series, second, edited)).toMatchObject({
      title: 'Analysis I',
      start: '2026-10-19T12:00',
      end: '2026-10-19T14:00',
      exdates: ['2026-11-02'],
    })
  })

  it('verschiebt die Serie samt Ausnahmen auf einen anderen Wochentag', () => {
    const edited = { ...series, start: '2026-10-27T10:15', end: '2026-10-27T11:45' }
    expect(applyToSeries(series, second, edited)).toMatchObject({ start: '2026-10-20T10:15', exdates: ['2026-11-03'] })
    const allDay = { ...series, allDay: true, start: '2026-10-26', end: '2026-10-28' }
    expect(applyToSeries(series, second, allDay)).toMatchObject({ start: '2026-10-19', end: '2026-10-21' })
    expect(applyToSeries(series, second, { ...edited, repeat: null }).exdates).toEqual([])
  })

  it('legt leere Termine mit einer Stunde Dauer an', () => {
    expect(blankEvent('2026-10-19T23:30')).toMatchObject({ start: '2026-10-19T23:30', end: '2026-10-20T00:30', allDay: false })
    expect(eventError({ ...blankEvent('2026-10-19T09:00'), title: 'x' })).toBeNull()
  })
})

describe('Tagesraster', () => {
  const day = '2026-10-19'
  const place = (events: CalendarEvent[]) =>
    layoutDay(occurrences(events, day, addDays(day, 1)), day).map((p) => ({
      title: p.occurrence.event.title,
      top: p.top,
      height: p.height,
      column: p.column,
      columns: p.columns,
    }))

  it('setzt sich überschneidende Termine nebeneinander – auch über Ketten', () => {
    expect(
      place([
        ev('A', `${day}T08:00`, `${day}T10:00`),
        ev('B', `${day}T09:00`, `${day}T11:00`),
        ev('C', `${day}T10:30`, `${day}T12:00`),
        ev('D', `${day}T14:00`, `${day}T15:00`),
      ]),
    ).toEqual([
      { title: 'A', top: 480, height: 120, column: 0, columns: 2 },
      { title: 'B', top: 540, height: 120, column: 1, columns: 2 },
      { title: 'C', top: 630, height: 90, column: 0, columns: 2 },
      { title: 'D', top: 840, height: 60, column: 0, columns: 1 },
    ])
  })

  it('schneidet Termine über Mitternacht ab und hält kurze Termine anklickbar', () => {
    const placed = layoutDay(
      occurrences(
        [ev('Nacht', '2026-10-18T22:00', `${day}T02:00`), ev('Kurz', `${day}T12:00`, `${day}T12:05`), ev('Frei', day, '2026-10-20')],
        day,
        '2026-10-20',
      ),
      day,
    )
    expect(placed.map((p) => [p.occurrence.event.title, p.top, p.height, p.continuesBefore, p.continuesAfter])).toEqual([
      ['Nacht', 0, 120, true, false],
      ['Kurz', 720, 20, false, false],
    ])
  })
})

describe('Terminliste', () => {
  const today = '2026-10-19' // Montag

  it('ordnet Termine ihren Tagen zu – heute immer, andere Tage nur mit Terminen', () => {
    const days = groupByDay(
      [
        ev('Übung', '2026-10-21T14:00', '2026-10-21T16:00'),
        ev('Vorlesung', '2026-10-12T08:15', '2026-10-12T09:45', { repeat: { weeks: 1, until: null } }),
        ev('Feiertag', '2026-10-19', '2026-10-20'),
      ],
      today,
      7,
    )
    expect(days.map((d) => [d.date, d.items.map((o) => o.event.title)])).toEqual([
      ['2026-10-19', ['Feiertag', 'Vorlesung']],
      ['2026-10-21', ['Übung']],
    ])
    expect(groupByDay([], today, 7).map((d) => d.date)).toEqual(['2026-10-19'])
  })

  it('zeigt mehrtägige Termine an jedem Tag mit passender Zeitangabe', () => {
    const night = ev('Nachtschicht', '2026-10-22T22:00', '2026-10-23T02:00')
    const untilMidnight = ev('Bis Mitternacht', '2026-10-24T20:00', '2026-10-25T00:00')
    const days = groupByDay([ev('Exkursion', '2026-10-20', '2026-10-22'), night, untilMidnight], today, 7)
    expect(days.map((d) => [d.date, d.items.map((o) => o.event.title)])).toEqual([
      ['2026-10-19', []],
      ['2026-10-20', ['Exkursion']],
      ['2026-10-21', ['Exkursion']],
      ['2026-10-22', ['Nachtschicht']],
      ['2026-10-23', ['Nachtschicht']],
      ['2026-10-24', ['Bis Mitternacht']],
    ])
    const [o] = days[3].items
    expect(timeLabel(o, '2026-10-22')).toBe('ab 22:00')
    expect(timeLabel(o, '2026-10-23')).toBe('bis 02:00')
    expect(timeLabel(days[5].items[0], '2026-10-24')).toBe('20:00–00:00')
    expect(timeLabel(days[1].items[0], '2026-10-20')).toBe('Ganztägig')
  })

  it('Tagesnamen', () => {
    expect(dayLabel('2026-10-19', today)).toBe('Heute')
    expect(dayLabel('2026-10-20', today)).toBe('Morgen')
    expect(dayLabel('2026-10-21', today)).toBe('Mittwoch, 21.10.')
  })

  it('Titel der Mitschrift: Datum und Termin, ohne Zeichen, die in Dateinamen stören', () => {
    const [o] = occurrences(
      [ev('Analysis I: Folgen/Reihen', '2026-10-12T08:00', '2026-10-12T10:00', { repeat: { weeks: 1, until: null } })],
      today,
      '2026-10-20',
    )
    expect(noteTitleFor(o)).toBe('2026-10-19 Analysis I- Folgen-Reihen')
  })

  it('Fokus starten: ganze Dauer, während des Termins die Restzeit', () => {
    const [block] = occurrences([ev('Lernblock', '2026-10-19T14:00', '2026-10-19T15:30')], today, '2026-10-20')
    expect(focusMinutes(block, '2026-10-19T09:00')).toBe(90)
    expect(focusMinutes(block, '2026-10-19T14:50')).toBe(40)
    expect(focusMinutes(block, '2026-10-19T15:30')).toBeNull()
    const [allDay] = occurrences([ev('Feiertag', '2026-10-19', '2026-10-20')], today, '2026-10-20')
    expect(focusMinutes(allDay, '2026-10-19T09:00')).toBeNull()
  })

  it('findet Termine mit Uhrzeit, die heute schon vorbei sind', () => {
    const events = [
      ev('Analysis I', '2026-10-12T08:15', '2026-10-12T09:45', { repeat: { weeks: 1, until: null } }),
      ev('Lineare Algebra', '2026-10-19T10:15', '2026-10-19T11:45'),
      ev('Feiertag', '2026-10-19', '2026-10-20'),
      ev('Gestern', '2026-10-18T08:00', '2026-10-18T09:00'),
      ev('Über Nacht', '2026-10-18T22:00', '2026-10-19T02:00'),
    ]
    expect(endedToday(events, '2026-10-19T08:00')).toEqual([])
    expect(endedToday(events, '2026-10-19T10:30').map((o) => `${o.event.title} ${o.date}`)).toEqual(['Analysis I 2026-10-19'])
    expect(endedToday(events, '2026-10-19T12:00').map((o) => o.event.title)).toEqual(['Analysis I', 'Lineare Algebra'])
  })
})
