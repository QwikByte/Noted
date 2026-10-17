import { describe, expect, it } from 'vitest'
import { agendaRange, dayLabel, groupByDay, noteTitleFor, timeLabel } from './agenda'
import type { CalendarEvent } from './types'

// Alle Zeiten in Ortszeit gebaut – so gilt der Test in jeder Zeitzone
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString()
const NOW = new Date(2026, 9, 19, 10, 30) // Montag, 19.10.2026

function ev(id: string, start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id, calendarId: 'c', subject: id, start, end, allDay: false, location: null, joinUrl: null, color: null, ...extra }
}

describe('Terminliste', () => {
  it('fragt ab heute 0:00 Uhr ab', () => {
    expect(agendaRange(NOW, 7)).toEqual({ start: new Date(2026, 9, 19).toISOString(), end: new Date(2026, 9, 26).toISOString() })
  })

  it('ordnet Termine ihren Tagen zu – heute immer, andere Tage nur mit Terminen', () => {
    const days = groupByDay(
      [
        ev('Übung', at(21, 14), at(21, 16)),
        ev('Vorlesung', at(19, 8, 15), at(19, 9, 45)),
        ev('Feiertag', '2026-10-19', '2026-10-20', { allDay: true }),
      ],
      NOW,
      7,
    )
    expect(days.map((d) => [d.key, d.events.map((e) => e.id)])).toEqual([
      ['2026-10-19', ['Feiertag', 'Vorlesung']],
      ['2026-10-21', ['Übung']],
    ])
    expect(groupByDay([], NOW, 7).map((d) => d.key)).toEqual(['2026-10-19'])
  })

  it('zeigt mehrtägige Termine an jedem Tag, Ende um Mitternacht zählt nicht mehr', () => {
    const trip = ev('Exkursion', '2026-10-20', '2026-10-22', { allDay: true })
    const night = ev('Nachtschicht', at(22, 22), at(23, 2))
    const untilMidnight = ev('Bis Mitternacht', at(24, 20), at(25, 0))
    const days = groupByDay([trip, night, untilMidnight], NOW, 7)
    expect(days.map((d) => [d.key, d.events.map((e) => e.id)])).toEqual([
      ['2026-10-19', []],
      ['2026-10-20', ['Exkursion']],
      ['2026-10-21', ['Exkursion']],
      ['2026-10-22', ['Nachtschicht']],
      ['2026-10-23', ['Nachtschicht']],
      ['2026-10-24', ['Bis Mitternacht']],
    ])
    expect(timeLabel(night, new Date(2026, 9, 22))).toBe('ab 22:00')
    expect(timeLabel(night, new Date(2026, 9, 23))).toBe('bis 02:00')
    expect(timeLabel(untilMidnight, new Date(2026, 9, 24))).toBe('20:00–00:00')
  })

  it('Zeitangaben und Tagesnamen', () => {
    expect(timeLabel(ev('a', at(19, 8, 15), at(19, 9, 45)), new Date(2026, 9, 19))).toBe('08:15–09:45')
    expect(timeLabel(ev('b', '2026-10-19', '2026-10-20', { allDay: true }), new Date(2026, 9, 19))).toBe('Ganztägig')
    expect(dayLabel(new Date(2026, 9, 19), NOW)).toBe('Heute')
    expect(dayLabel(new Date(2026, 9, 20), NOW)).toBe('Morgen')
    expect(dayLabel(new Date(2026, 9, 21), NOW)).toBe('Mittwoch, 21.10.')
  })

  it('Titel der Mitschrift: Datum und Termin, ohne Zeichen, die in Dateinamen stören', () => {
    expect(noteTitleFor(ev('Analysis I: Folgen/Reihen', at(19, 8), at(19, 10)), new Date(2026, 9, 19))).toBe(
      '2026-10-19 Analysis I- Folgen-Reihen',
    )
  })
})
