// Termine prüfen und Wiederholungen auflösen. Reine Logik – Server und Browser nutzen dieselben Regeln.
import { MAX_EXAM_DECKS, MAX_EXDATES, MAX_LOCATION, MAX_NOTES, MAX_REPEAT_WEEKS, MAX_TITLE } from './limits'
import { addDays, addMinutes, dateOf, daysBetween, isValidDate, isValidDateTime, minutesBetween, timeOf } from './dates'
import type { CalendarEvent, EventInput, Occurrence } from './types'

/** Fehlermeldung für die Oberfläche, null = in Ordnung */
export function eventError(e: EventInput): string | null {
  if (!e.title.trim()) return 'Bitte gib einen Titel ein.'
  if (e.title.length > MAX_TITLE || e.location.length > MAX_LOCATION || e.notes.length > MAX_NOTES) return 'Der Text ist zu lang.'
  if (e.allDay) {
    if (!isValidDate(e.start) || !isValidDate(e.end)) return 'Bitte gib gültige Tage an.'
    if (e.end <= e.start) return 'Der letzte Tag liegt vor dem ersten.'
  } else {
    if (!isValidDateTime(e.start) || !isValidDateTime(e.end)) return 'Bitte gib gültige Zeiten an.'
    if (e.end < e.start) return 'Das Ende liegt vor dem Beginn.'
  }
  if (e.repeat) {
    const { weeks, until } = e.repeat
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_REPEAT_WEEKS) return 'Ungültige Wiederholung.'
    if (until !== null && (!isValidDate(until) || until < dateOf(e.start))) return 'Die Wiederholung endet vor dem ersten Termin.'
  }
  if (e.exdates.length > MAX_EXDATES || e.exdates.some((d) => !isValidDate(d))) return 'Ungültige Ausnahmen.'
  if (e.exam) {
    if (e.repeat) return 'Eine Klausur kann sich nicht wiederholen.'
    if (e.exam.deckIds.length > MAX_EXAM_DECKS) return `Höchstens ${MAX_EXAM_DECKS} Stapel pro Klausur.`
  }
  return null
}

/** Dauer in Minuten bzw. (ganztägig) Tagen */
const duration = (e: EventInput) => (e.allDay ? daysBetween(e.start, e.end) : minutesBetween(e.start, e.end))
const shift = (e: EventInput, value: string, n: number) => (e.allDay ? addDays(value, n) : addMinutes(value, n))

/** Überschneidet ein Termin von start bis end die Tage [first, last)? */
function overlaps(e: EventInput, start: string, end: string, first: string, last: string): boolean {
  if (e.allDay) return start < last && end > first
  // Termine ohne Dauer zählen an ihrem Tag
  const until = end === start ? addMinutes(end, 1) : end
  return start < `${last}T00:00` && until > `${first}T00:00`
}

/** Alle Vorkommen der Termine, die die Tage [first, last) berühren – sortiert nach Beginn */
export function occurrences(events: CalendarEvent[], first: string, last: string): Occurrence[] {
  const out: Occurrence[] = []
  for (const event of events) {
    const len = duration(event)
    if (!event.repeat) {
      if (overlaps(event, event.start, event.end, first, last)) {
        out.push({ event, date: dateOf(event.start), start: event.start, end: event.end })
      }
      continue
    }
    const step = event.repeat.weeks * 7
    const startDate = dateOf(event.start)
    // Erstes Vorkommen, das noch in den Zeitraum hineinragen kann (lange Termine beginnen schon vorher)
    const spanDays = event.allDay ? len : Math.ceil(len / 1440)
    const skip = Math.max(0, Math.floor((daysBetween(startDate, first) - spanDays) / step))
    const excluded = new Set(event.exdates)
    for (let k = skip; ; k++) {
      const date = addDays(startDate, k * step)
      if (date >= last || (event.repeat.until !== null && date > event.repeat.until)) break
      if (excluded.has(date)) continue
      const start = shift(event, event.start, k * step * (event.allDay ? 1 : 1440))
      const end = shift(event, start, len)
      if (overlaps(event, start, end, first, last)) out.push({ event, date, start, end })
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || Number(b.event.allDay) - Number(a.event.allDay))
}

/** Leerer Termin ab `start` (YYYY-MM-DDTHH:mm) */
export function blankEvent(start: string, minutes = 60): EventInput {
  return {
    title: '',
    location: '',
    notes: '',
    color: null,
    allDay: false,
    start,
    end: addMinutes(start, minutes),
    repeat: null,
    exdates: [],
    exam: null,
  }
}

/**
 * Änderung an einem Vorkommen auf die ganze Serie übertragen: Die Serie verschiebt sich um so viele Tage wie dieses
 * Vorkommen und übernimmt Uhrzeit und Dauer – ihr erster Termin bleibt der erste, ausfallende Tage wandern mit.
 */
export function applyToSeries(series: CalendarEvent, o: Occurrence, edited: EventInput): EventInput {
  const days = daysBetween(dateOf(o.start), dateOf(edited.start))
  const first = addDays(dateOf(series.start), days)
  const start = edited.allDay ? first : `${first}T${timeOf(edited.start)}`
  const end = edited.allDay
    ? addDays(start, daysBetween(edited.start, edited.end))
    : addMinutes(start, minutesBetween(edited.start, edited.end))
  return { ...edited, start, end, exdates: edited.repeat ? series.exdates.map((d) => addDays(d, days)) : [] }
}

/** Ist das Vorkommen an diesem Tag zu sehen? (mehrtägige Termine an jedem ihrer Tage) */
export function onDay(o: Occurrence, day: string): boolean {
  return overlaps(o.event, o.start, o.end, day, addDays(day, 1))
}
