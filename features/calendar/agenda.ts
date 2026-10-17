// Terminliste fürs Dashboard: Zeitraum, Tage in Ortszeit, Zeitangaben. Reine Logik ohne Browser-Abhängigkeit.
import { sanitizeName } from '@/shared/lib/names'
import type { CalendarEvent } from './types'

export type AgendaDay = { key: string; date: Date; events: CalendarEvent[] }

const pad = (n: number) => String(n).padStart(2, '0')

/** Tag in Ortszeit als YYYY-MM-DD */
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
/** YYYY-MM-DD als Tag in Ortszeit (ganztägige Termine) */
const localDate = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Ab heute 0:00 Uhr (Ortszeit) über `days` Tage – als Abfrage für die API */
export function agendaRange(now: Date, days: number): { start: string; end: string } {
  const start = startOfDay(now)
  return { start: start.toISOString(), end: addDays(start, days).toISOString() }
}

/** Erster und letzter Tag (Ortszeit), an denen ein Termin stattfindet */
function span(ev: CalendarEvent): [Date, Date] {
  if (ev.allDay) return [localDate(ev.start), addDays(localDate(ev.end), -1)]
  const start = new Date(ev.start)
  // Endet ein Termin um Mitternacht, gehört der Folgetag nicht mehr dazu
  const end = new Date(Math.max(start.getTime(), new Date(ev.end).getTime() - 1))
  return [startOfDay(start), startOfDay(end)]
}

/** Termine nach Tagen; mehrtägige erscheinen an jedem Tag. Heute steht immer drin, andere Tage nur mit Terminen. */
export function groupByDay(events: CalendarEvent[], now: Date, days: number): AgendaDay[] {
  const first = startOfDay(now)
  const out: AgendaDay[] = []
  for (let i = 0; i < days; i++) {
    const date = addDays(first, i)
    const onDay = events
      .filter((ev) => {
        const [from, to] = span(ev)
        return from <= date && date <= to
      })
      // Ganztägig zuerst, dann nach Beginn
      .sort((a, b) => Number(b.allDay) - Number(a.allDay) || new Date(a.start).getTime() - new Date(b.start).getTime())
    if (i === 0 || onDay.length > 0) out.push({ key: dayKey(date), date, events: onDay })
  }
  return out
}

const time = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

/** „08:15–09:45“, „Ganztägig“ – bei mehrtägigen Terminen „ab 22:00“ bzw. „bis 02:00“ */
export function timeLabel(ev: CalendarEvent, day: Date): string {
  if (ev.allDay) return 'Ganztägig'
  const [from, to] = span(ev)
  const start = new Date(ev.start)
  const end = new Date(ev.end)
  const isFirst = from.getTime() === day.getTime()
  const isLast = to.getTime() === day.getTime()
  if (isFirst && isLast) return start.getTime() === end.getTime() ? time(start) : `${time(start)}–${time(end)}`
  if (isFirst) return `ab ${time(start)}`
  if (isLast) return `bis ${time(end)}`
  return 'Ganztägig'
}

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']

/** „Heute“, „Morgen“, sonst „Mittwoch, 21.10.“ */
export function dayLabel(day: Date, now: Date): string {
  const diff = Math.round((day.getTime() - startOfDay(now).getTime()) / 86_400_000)
  if (diff === 0) return 'Heute'
  if (diff === 1) return 'Morgen'
  return `${WEEKDAYS[day.getDay()]}, ${pad(day.getDate())}.${pad(day.getMonth() + 1)}.`
}

/** Titel der Mitschrift zu einem Termin – im Stil der Vorlage „Vorlesung“: Datum vorn, dann der Termin */
export const noteTitleFor = (ev: CalendarEvent, day: Date) => sanitizeName(`${dayKey(day)} ${ev.subject}`)
