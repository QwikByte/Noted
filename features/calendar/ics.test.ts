import { describe, expect, it } from 'vitest'
import { parseIcs, toIcs } from './ics'
import { MAX_IMPORT_EVENTS } from './limits'
import type { CalendarEvent } from './types'

function ev(title: string, start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: title.toLowerCase().replace(/\W/g, ''),
    title,
    location: '',
    notes: '',
    color: null,
    allDay: start.length === 10,
    start,
    end,
    repeat: null,
    exdates: [],
    createdAt: 0,
    updatedAt: Date.UTC(2026, 9, 17, 12),
    ...extra,
  }
}

/** .ics mit einem VEVENT pro Eintrag; Zeilen als Liste, damit die Tests lesbar bleiben */
const ics = (...events: string[][]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.flatMap((e) => ['BEGIN:VEVENT', ...e, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n')

const BERLIN = 'Europe/Berlin'

describe('.ics schreiben', () => {
  it('schreibt Termine ohne Zeitzone, mit Wiederholung, Ausnahmen und Farbe', () => {
    const text = toIcs([
      ev('Analysis', '2026-10-19T10:15', '2026-10-19T11:45', {
        location: 'Hörsaal 1',
        color: 4,
        repeat: { weeks: 2, until: '2027-02-08' },
        exdates: ['2026-11-02'],
      }),
      ev('Feiertag', '2026-10-31', '2026-11-01'),
    ])
    const lines = text.split('\r\n')
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(lines).toContain('UID:analysis@noted')
    expect(lines).toContain('DTSTAMP:20261017T120000Z')
    expect(lines).toContain('DTSTART:20261019T101500')
    expect(lines).toContain('DTEND:20261019T114500')
    expect(lines).toContain('RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=20270208T235959')
    expect(lines).toContain('EXDATE:20261102T101500')
    expect(lines).toContain('COLOR:green')
    expect(lines).toContain('DTSTART;VALUE=DATE:20261031')
    expect(lines).toContain('DTEND;VALUE=DATE:20261101')
  })

  it('maskiert Sonderzeichen und bricht lange Zeilen nach 75 Byte um', () => {
    const notes = 'Übungsblatt; Aufgabe 1, 2 und 3\nAbgabe C:\\Uni ' + 'äöü'.repeat(40)
    const text = toIcs([ev('Mathe', '2026-10-19T10:00', '2026-10-19T11:00', { notes })])
    for (const line of text.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    expect(text).toContain('DESCRIPTION:Übungsblatt\\; Aufgabe 1\\, 2 und 3\\nAbgabe C:\\\\Uni')
    expect(parseIcs(text, BERLIN).events[0].notes).toBe(notes)
  })

  it('liest geschriebene Termine unverändert wieder ein', () => {
    const events = [
      ev('Analysis: Folgen', '2026-10-19T10:15', '2026-10-19T11:45', {
        location: 'Hörsaal 1, Gebäude A',
        notes: 'Skript mitbringen',
        color: 6,
        repeat: { weeks: 1, until: '2027-02-08' },
        exdates: ['2026-11-02', '2026-12-28'],
      }),
      ev('Exkursion', '2026-10-23', '2026-10-25', { repeat: { weeks: 3, until: null } }),
      ev('Abgabe', '2026-10-20T23:59', '2026-10-20T23:59'),
    ]
    const result = parseIcs(toIcs(events), BERLIN)
    expect(result.skipped).toBe(0)
    // toEqual übergeht Felder mit undefined – die Kennung und Zeitstempel vergibt erst der Server
    expect(result.events).toEqual(
      events.map((e) => ({ ...e, id: undefined, createdAt: undefined, updatedAt: undefined, uid: `${e.id}@noted` })),
    )
  })
})

describe('.ics lesen', () => {
  it('rechnet UTC und fremde Zeitzonen in die eigene um – auch über die Zeitumstellung', () => {
    const { events } = parseIcs(
      ics(
        ['UID:a', 'SUMMARY:UTC', 'DTSTART:20261019T080000Z', 'DTEND:20261019T093000Z'],
        ['UID:b', 'SUMMARY:New York', 'DTSTART;TZID=America/New_York:20261019T040000', 'DTEND;TZID=America/New_York:20261019T050000'],
        ['UID:c', 'SUMMARY:Umstellung', 'DTSTART:20261025T003000Z', 'DTEND:20261025T013000Z'],
        ['UID:d', 'SUMMARY:Outlook', 'DTSTART;TZID="W. Europe Standard Time":20261019T101500', 'DTEND;TZID="W. Europe Standard Time":20261019T114500'],
        ['UID:e', 'SUMMARY:Ohne Zone', 'DTSTART:20261019T101500', 'DTEND:20261019T114500'],
      ),
      BERLIN,
    )
    expect(events.map((e) => [e.title, e.start, e.end])).toEqual([
      ['UTC', '2026-10-19T10:00', '2026-10-19T11:30'],
      ['New York', '2026-10-19T10:00', '2026-10-19T11:00'],
      // 00:30 UTC ist noch Sommerzeit (02:30), 01:30 UTC schon Winterzeit (02:30)
      ['Umstellung', '2026-10-25T02:30', '2026-10-25T02:30'],
      ['Outlook', '2026-10-19T10:15', '2026-10-19T11:45'],
      ['Ohne Zone', '2026-10-19T10:15', '2026-10-19T11:45'],
    ])
    // Zeitzone, deren Umstellung auf einen anderen Tag fällt
    const [ny] = parseIcs(ics(['UID:x', 'SUMMARY:x', 'DTSTART;TZID=Europe/Berlin:20261025T120000']), 'America/New_York').events
    expect(ny.start).toBe('2026-10-25T07:00')
  })

  it('entfaltet Zeilen, liest Text und Dauer und überspringt Erinnerungen', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:1',
      'SUMMARY:Lange Vor',
      ' lesung\\, Teil 1',
      'DTSTART:20261019T101500',
      'DURATION:PT1H30M',
      'LOCATION:Raum 2\\;3',
      'BEGIN:VALARM',
      'DESCRIPTION:Erinnerung',
      'TRIGGER:-PT15M',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n')
    expect(parseIcs(text, BERLIN).events).toEqual([
      {
        uid: '1',
        title: 'Lange Vorlesung, Teil 1',
        location: 'Raum 2;3',
        notes: '',
        color: null,
        allDay: false,
        start: '2026-10-19T10:15',
        end: '2026-10-19T11:45',
        repeat: null,
        exdates: [],
      },
    ])
  })

  it('ganztägige Termine ohne Ende dauern einen Tag', () => {
    const [e] = parseIcs(ics(['UID:1', 'SUMMARY:Feiertag', 'DTSTART;VALUE=DATE:20261031']), BERLIN).events
    expect([e.allDay, e.start, e.end]).toEqual([true, '2026-10-31', '2026-11-01'])
  })

  it('übernimmt wöchentliche Wiederholungen mit Abstand, Ende, Anzahl und Ausnahmen', () => {
    const { events, simplified } = parseIcs(
      ics(
        [
          'UID:a',
          'SUMMARY:Ende',
          'DTSTART;TZID=Europe/Berlin:20261019T101500',
          'DTEND;TZID=Europe/Berlin:20261019T114500',
          // Outlook schreibt das Ende in UTC: 09:15 UTC ist 10:15 Ortszeit – der 8.2. zählt also noch
          'RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=20270208T091500Z',
          'EXDATE;TZID=Europe/Berlin:20261102T101500,20261116T101500',
        ],
        ['UID:b', 'SUMMARY:Knapp', 'DTSTART:20261019T101500', 'DTEND:20261019T114500', 'RRULE:FREQ=WEEKLY;UNTIL=20261109T080000Z'],
        ['UID:c', 'SUMMARY:Anzahl', 'DTSTART:20261021T140000', 'DTEND:20261021T160000', 'RRULE:FREQ=WEEKLY;COUNT=3'],
        ['UID:d', 'SUMMARY:Täglich', 'DTSTART:20261019T080000', 'DTEND:20261019T081500', 'RRULE:FREQ=DAILY;COUNT=5'],
      ),
      BERLIN,
    )
    expect(events.map((e) => [e.title, e.repeat, e.exdates])).toEqual([
      ['Ende', { weeks: 2, until: '2027-02-08' }, ['2026-11-02', '2026-11-16']],
      // 08:00 UTC ist 09:00 Ortszeit – vor dem Termin um 10:15, also endet die Serie eine Woche früher
      ['Knapp', { weeks: 1, until: '2026-11-08' }, []],
      ['Anzahl', { weeks: 1, until: '2026-11-10' }, []],
      ['Täglich', null, []],
    ])
    expect(simplified).toBe(1)
  })

  it('teilt Serien an mehreren Wochentagen in je einen Termin pro Tag', () => {
    const { events } = parseIcs(
      ics([
        'UID:serie',
        'SUMMARY:Tutorium',
        'DTSTART:20261019T120000',
        'DTEND:20261019T130000',
        'RRULE:FREQ=WEEKLY;BYDAY=MO,TH;COUNT=4',
        'EXDATE:20261022T120000,20261026T120000',
      ]),
      BERLIN,
    )
    expect(events.map((e) => [e.uid, e.start, e.end, e.repeat?.until, e.exdates])).toEqual([
      ['serie#MO', '2026-10-19T12:00', '2026-10-19T13:00', '2026-11-01', ['2026-10-26']],
      ['serie#TH', '2026-10-22T12:00', '2026-10-22T13:00', '2026-11-01', ['2026-10-22']],
    ])
  })

  it('geänderte und abgesagte Einzeltermine fallen in der Serie aus', () => {
    const { events, skipped } = parseIcs(
      ics(
        ['UID:s', 'SUMMARY:Vorlesung', 'DTSTART:20261019T101500', 'DTEND:20261019T114500', 'RRULE:FREQ=WEEKLY'],
        ['UID:s', 'RECURRENCE-ID:20261026T101500', 'SUMMARY:Vorlesung (Raum 5)', 'DTSTART:20261026T121500', 'DTEND:20261026T134500'],
        ['UID:s', 'RECURRENCE-ID:20261102T101500', 'STATUS:CANCELLED', 'DTSTART:20261102T101500'],
        ['UID:x', 'SUMMARY:Abgesagt', 'STATUS:CANCELLED', 'DTSTART:20261020T100000'],
        ['UID:y', 'SUMMARY:Ohne Beginn'],
      ),
      BERLIN,
    )
    expect(events.map((e) => [e.uid, e.title, e.start, e.repeat, e.exdates])).toEqual([
      ['s', 'Vorlesung', '2026-10-19T10:15', { weeks: 1, until: null }, ['2026-10-26', '2026-11-02']],
      ['s@2026-10-26', 'Vorlesung (Raum 5)', '2026-10-26T12:15', null, []],
    ])
    expect(skipped).toBe(3)
  })

  it('nimmt höchstens die erlaubte Anzahl Termine an', () => {
    const many = Array.from({ length: MAX_IMPORT_EVENTS + 2 }, (_, i) => [`UID:${i}`, 'SUMMARY:x', 'DTSTART;VALUE=DATE:20261019'])
    const result = parseIcs(ics(...many), BERLIN)
    expect(result.events).toHaveLength(MAX_IMPORT_EVENTS)
    expect(result.skipped).toBe(2)
  })
})
