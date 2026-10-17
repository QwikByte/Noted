// Terminliste für die Startseite und Beschriftungen von Terminen. Reine Logik ohne Browser-Abhängigkeit.
import { sanitizeName } from '@/shared/lib/names'
import { addDays, dateOf, daysBetween, minutesBetween, shortDate, timeOf, weekdayName } from './dates'
import { occurrences, onDay } from './event'
import type { CalendarEvent, Occurrence } from './types'

export type AgendaDay = { date: string; items: Occurrence[] }

/** Termine ab `today` über `days` Tage; mehrtägige an jedem Tag. Heute steht immer drin, andere Tage nur mit Terminen. */
export function groupByDay(events: CalendarEvent[], today: string, days: number): AgendaDay[] {
  const all = occurrences(events, today, addDays(today, days))
  const out: AgendaDay[] = []
  for (let i = 0; i < days; i++) {
    const date = addDays(today, i)
    const items = all.filter((o) => onDay(o, date))
    if (i === 0 || items.length > 0) out.push({ date, items })
  }
  return out
}

/** „08:15–09:45“, „Ganztägig“ – bei Terminen über Mitternacht „ab 22:00“ bzw. „bis 02:00“ */
export function timeLabel(o: Occurrence, day: string): string {
  if (o.event.allDay) return 'Ganztägig'
  const isFirst = dateOf(o.start) === day
  // Endet ein Termin um Mitternacht, gehört der Folgetag nicht mehr dazu
  const isLast = dateOf(o.end) === day || (o.end === `${addDays(day, 1)}T00:00` && o.end > o.start)
  if (isFirst && isLast) return o.start === o.end ? timeOf(o.start) : `${timeOf(o.start)}–${timeOf(o.end)}`
  if (isFirst) return `ab ${timeOf(o.start)}`
  if (isLast) return `bis ${timeOf(o.end)}`
  return 'Ganztägig'
}

/** „Heute“, „Morgen“, sonst „Mittwoch, 21.10.“ */
export function dayLabel(day: string, today: string): string {
  const diff = daysBetween(today, day)
  if (diff === 0) return 'Heute'
  if (diff === 1) return 'Morgen'
  return `${weekdayName(day)}, ${shortDate(day)}`
}

/** Titel der Mitschrift zu einem Termin – im Stil der Vorlage „Vorlesung“: Datum vorn, dann der Termin */
export const noteTitleFor = (o: Occurrence) => sanitizeName(`${o.date} ${o.event.title}`)

/**
 * Dauer für „Fokus starten“ in Minuten (`now`: Ortszeit YYYY-MM-DDTHH:mm): die ganze Dauer, läuft der Termin schon,
 * die Restzeit. null bei ganztägigen und schon beendeten Terminen.
 */
export function focusMinutes(o: Occurrence, now: string): number | null {
  if (o.event.allDay || o.end <= now || o.end <= o.start) return null
  return minutesBetween(o.start > now ? o.start : now, o.end)
}

/** Termine mit Uhrzeit, die heute begonnen haben und schon vorbei sind (`now`: Ortszeit YYYY-MM-DDTHH:mm) */
export function endedToday(events: CalendarEvent[], now: string): Occurrence[] {
  const today = dateOf(now)
  return occurrences(events, today, addDays(today, 1)).filter(
    (o) => !o.event.allDay && dateOf(o.start) === today && o.end > o.start && o.end <= now,
  )
}
