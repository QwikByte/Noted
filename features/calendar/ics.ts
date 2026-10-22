// .ics (iCalendar, RFC 5545): Termine schreiben und lesen. Reine Logik – läuft im Browser (Import) und auf dem Server
// (Download, ZIP-Export). Noted speichert Ortszeit ohne Zone; Zeiten aus anderen Zonen werden in `timeZone` umgerechnet.
import { MAX_IMPORT_EVENTS, MAX_LOCATION, MAX_NOTES, MAX_REPEAT_WEEKS, MAX_TITLE, MAX_UID } from './limits'
import { addDays, addMinutes, dateOf, timeOf, wallMs, weekday } from './dates'
import { eventError } from './event'
import type { CalendarEvent, EventColor, ImportedEvent } from './types'

// RFC 7986 erlaubt CSS-Farbnamen – so behalten Termine ihre Farbe in anderen Kalendern
const COLOR_NAMES: Record<EventColor, string> = { 1: 'red', 2: 'orange', 3: 'gold', 4: 'green', 5: 'teal', 6: 'purple' }
const DAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

// --- Schreiben ---------------------------------------------------------------------------------------------------------

const escapeText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

const encoder = new TextEncoder()

/** Zeilen über 75 Byte umbrechen; Folgezeilen beginnen mit einem Leerzeichen */
function fold(line: string): string {
  if (encoder.encode(line).length <= 75) return line
  const parts: string[] = []
  let current = ''
  let bytes = 0
  for (const ch of line) {
    const n = encoder.encode(ch).length
    if (bytes + n > (parts.length === 0 ? 75 : 74)) {
      parts.push(current)
      current = ''
      bytes = 0
    }
    current += ch
    bytes += n
  }
  parts.push(current)
  return parts.join('\r\n ')
}

const icsDate = (date: string) => date.replace(/-/g, '')
const icsDateTime = (value: string) => `${icsDate(dateOf(value))}T${timeOf(value).replace(':', '')}00`
const icsStamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

/** Kalender als .ics – Zeiten ohne Zone („floating“), wie Noted sie speichert */
export function toIcs(events: (CalendarEvent & { uid?: string | null })[], now = Date.now()): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Noted//Kalender//DE', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Noted']
  for (const e of events) {
    const type = e.allDay ? ';VALUE=DATE' : ''
    const value = (v: string) => (e.allDay ? icsDate(v) : icsDateTime(v))
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid ?? `${e.id}@noted`}`,
      `DTSTAMP:${icsStamp(e.updatedAt || now)}`,
      `DTSTART${type}:${value(e.start)}`,
      `DTEND${type}:${value(e.end)}`,
      `SUMMARY:${escapeText(e.title)}`,
    )
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`)
    if (e.notes) lines.push(`DESCRIPTION:${escapeText(e.notes)}`)
    if (e.color) lines.push(`COLOR:${COLOR_NAMES[e.color]}`)
    if (e.repeat) {
      const interval = e.repeat.weeks > 1 ? `;INTERVAL=${e.repeat.weeks}` : ''
      const until = e.repeat.until ? `;UNTIL=${icsDate(e.repeat.until)}${e.allDay ? '' : 'T235959'}` : ''
      lines.push(`RRULE:FREQ=WEEKLY${interval}${until}`)
      if (e.exdates.length) {
        const time = e.allDay ? '' : `T${timeOf(e.start).replace(':', '')}00`
        lines.push(`EXDATE${type}:${e.exdates.map((d) => icsDate(d) + time).join(',')}`)
      }
    }
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}

// --- Zeitzonen ---------------------------------------------------------------------------------------------------------

/** Kennt der Browser bzw. Server diese Zeitzone (z. B. „Europe/Berlin“)? */
export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Uhrzeit (YYYY-MM-DDTHH:mm), die eine Uhr in `timeZone` zum Zeitpunkt `ms` zeigt */
function wallInZone(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

/** Zeitpunkt, zu dem eine Uhr in `timeZone` die Uhrzeit `wall` zeigt */
function instantOfWall(wall: string, timeZone: string): number {
  const guess = wallMs(wall)
  const offset = (t: number) => wallMs(wallInZone(t, timeZone)) - t
  const first = guess - offset(guess)
  // Nahe der Zeitumstellung stimmt der erste Versatz nicht – einmal nachrechnen
  return guess - offset(first)
}

// --- Lesen -------------------------------------------------------------------------------------------------------------

type Prop = { name: string; params: Record<string, string>; value: string }

function splitOutsideQuotes(s: string, sep: string): string[] {
  const out: string[] = []
  let current = ''
  let quoted = false
  for (const ch of s) {
    if (ch === '"') quoted = !quoted
    if (ch === sep && !quoted) {
      out.push(current)
      current = ''
    } else current += ch
  }
  out.push(current)
  return out
}

function parseLine(line: string): Prop | null {
  let quoted = false
  let colon = -1
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted
    else if (line[i] === ':' && !quoted) {
      colon = i
      break
    }
  }
  if (colon < 0) return null
  const [name, ...rawParams] = splitOutsideQuotes(line.slice(0, colon), ';')
  const params: Record<string, string> = {}
  for (const p of rawParams) {
    const eq = p.indexOf('=')
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '')
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) }
}

const unescapeText = (s: string) => s.replace(/\\([nN,;\\])/g, (_m, c: string) => (c === 'n' || c === 'N' ? '\n' : c))

/** Datum bzw. Uhrzeit in Ortszeit von `timeZone`; null = unlesbar */
function parseTime(value: string, params: Record<string, string>, timeZone: string): { value: string; allDay: boolean } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim())
  if (!m) return null
  const date = `${m[1]}-${m[2]}-${m[3]}`
  if (!m[4] || params.VALUE === 'DATE') return { value: date, allDay: true }
  const wall = `${date}T${m[4]}:${m[5]}`
  if (m[7]) return { value: wallInZone(wallMs(wall) + Number(m[6] ?? 0) * 1000, timeZone), allDay: false }
  const tzid = params.TZID?.replace(/^\//, '')
  // Unbekannte Zonen (z. B. „W. Europe Standard Time“ aus Outlook) gelten als Ortszeit – meist ist es dieselbe
  if (tzid && tzid !== timeZone && isTimeZone(tzid)) return { value: wallInZone(instantOfWall(wall, tzid), timeZone), allDay: false }
  return { value: wall, allDay: false }
}

/** DURATION (z. B. PT1H30M, P1D) in Minuten */
function parseDuration(value: string): number | null {
  const m = /^\+?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim())
  if (!m) return null
  const [w, d, h, min] = [m[1], m[2], m[3], m[4]].map((x) => Number(x ?? 0))
  return ((w * 7 + d) * 24 + h) * 60 + min
}

const shiftBy = (value: string, days: number) => (value.length > 10 ? addMinutes(value, days * 1440) : addDays(value, days))

type RawEvent = Map<string, Prop[]>

/** Komponenten VEVENT einsammeln; verschachtelte (z. B. VALARM) überspringen */
function rawEvents(text: string): RawEvent[] {
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r\n|\n|\r/)
  const out: RawEvent[] = []
  let current: RawEvent | null = null
  let nested = 0
  for (const line of lines) {
    const prop = parseLine(line)
    if (!prop) continue
    const value = prop.value.trim().toUpperCase()
    if (prop.name === 'BEGIN') {
      if (value === 'VEVENT' && !current) current = new Map()
      else if (current) nested++
      continue
    }
    if (prop.name === 'END') {
      if (current && nested > 0) nested--
      else if (current && value === 'VEVENT') {
        out.push(current)
        current = null
      }
      continue
    }
    if (current && nested === 0) current.set(prop.name, [...(current.get(prop.name) ?? []), prop])
  }
  return out
}

type IcsImport = {
  events: ImportedEvent[]
  /** Unlesbar, abgesagt oder über der Grenze */
  skipped: number
  /** Wiederholungen, die Noted nicht abbildet (täglich, monatlich …) – nur der erste Termin wurde übernommen */
  simplified: number
}

/** Termine aus einer .ics-Datei; Zeiten in Ortszeit von `timeZone` */
export function parseIcs(text: string, timeZone: string): IcsImport {
  const result: IcsImport = { events: [], skipped: 0, simplified: 0 }
  const masters = new Map<string, ImportedEvent[]>()
  const overrides: { uid: string; date: string }[] = []

  for (const raw of rawEvents(text)) {
    const first = (name: string) => raw.get(name)?.[0]
    const textOf = (name: string, max: number) => unescapeText(first(name)?.value ?? '').trim().slice(0, max)
    const uid = first('UID')?.value.trim().slice(0, MAX_UID) || null
    const recurrenceId = first('RECURRENCE-ID')
    const replaced = recurrenceId && parseTime(recurrenceId.value, recurrenceId.params, timeZone)
    if (first('STATUS')?.value.trim().toUpperCase() === 'CANCELLED') {
      // Abgesagtes Einzelvorkommen: fällt in der Serie aus
      if (replaced && uid) overrides.push({ uid, date: dateOf(replaced.value) })
      result.skipped++
      continue
    }
    const dtstart = first('DTSTART')
    const start = dtstart && parseTime(dtstart.value, dtstart.params, timeZone)
    if (!start) {
      result.skipped++
      continue
    }
    const allDay = start.allDay
    const dtend = first('DTEND')
    const parsedEnd = dtend && parseTime(dtend.value, dtend.params, timeZone)
    const dur = first('DURATION')
    const minutes = dur ? parseDuration(dur.value) : null
    let given: string | null = null
    if (parsedEnd) given = allDay ? dateOf(parsedEnd.value) : parsedEnd.allDay ? `${parsedEnd.value}T00:00` : parsedEnd.value
    else if (minutes !== null) given = allDay ? addDays(start.value, Math.round(minutes / 1440)) : addMinutes(start.value, minutes)
    // Ohne (gültiges) Ende dauert ein ganztägiger Termin einen Tag, einer mit Uhrzeit nur einen Augenblick (RFC 5545)
    const end = allDay
      ? given !== null && given > start.value ? given : addDays(start.value, 1)
      : given !== null && given >= start.value ? given : start.value

    const colorName = first('COLOR')?.value.trim().toLowerCase()
    const color = (Object.entries(COLOR_NAMES).find(([, name]) => name === colorName)?.[0] ?? null) as `${EventColor}` | null
    const base: ImportedEvent = {
      uid,
      title: textOf('SUMMARY', MAX_TITLE) || '(Ohne Titel)',
      location: textOf('LOCATION', MAX_LOCATION),
      notes: textOf('DESCRIPTION', MAX_NOTES),
      color: color ? (Number(color) as EventColor) : null,
      allDay,
      start: start.value,
      end,
      repeat: null,
      exdates: [],
      exam: null,
    }

    const rule = first('RRULE')
    const variants: ImportedEvent[] = []
    if (replaced && uid) {
      // Geändertes Einzelvorkommen einer Serie: eigener Termin, in der Serie ausgelassen
      const date = dateOf(replaced.value)
      overrides.push({ uid, date })
      variants.push({ ...base, uid: `${uid}@${date}` })
    } else if (!rule) variants.push(base)
    else {
      const parts = Object.fromEntries(rule.value.split(';').map((p) => p.split('=') as [string, string]).map(([k, v]) => [k.toUpperCase(), v]))
      if (parts.FREQ?.toUpperCase() !== 'WEEKLY') {
        result.simplified++
        variants.push(base)
      } else {
        const weeks = Math.min(MAX_REPEAT_WEEKS, Math.max(1, Number(parts.INTERVAL) || 1))
        const startDate = dateOf(base.start)
        const byDay = (parts.BYDAY ?? '')
          .split(',')
          .map((d: string) => DAY_CODES.indexOf(d.replace(/^[+-]?\d+/, '').toUpperCase()))
          .filter((d: number) => d >= 0)
        const days = byDay.length ? [...new Set(byDay)] : [weekday(startDate)]
        let until: string | null = null
        if (parts.UNTIL) {
          // UNTIL ist ein Zeitpunkt – liegt er am letzten Tag vor der Uhrzeit des Termins, zählt dieser Tag nicht mehr
          const last = parseTime(parts.UNTIL, {}, timeZone)
          if (!last) until = startDate
          else if (last.allDay || allDay || timeOf(base.start) <= timeOf(last.value)) until = dateOf(last.value)
          else until = addDays(dateOf(last.value), -1)
        } else if (parts.COUNT) {
          // Bei mehreren Wochentagen verteilt sich COUNT auf sie – auf ganze Wochen aufgerundet
          const perDay = Math.ceil(Math.max(1, Number(parts.COUNT)) / days.length)
          until = addDays(startDate, (perDay - 1) * 7 * weeks + 6)
        }
        const exdates = (raw.get('EXDATE') ?? []).flatMap((p) =>
          p.value.split(',').map((v) => parseTime(v, p.params, timeZone)).filter((t) => t !== null).map((t) => dateOf(t.value)),
        )
        for (const day of days) {
          const offset = (day - weekday(startDate) + 7) % 7
          const startAt = shiftBy(base.start, offset)
          // Fällt der erste Wochentag schon hinter das Ende der Serie, gibt es ihn gar nicht
          if (until !== null && until < dateOf(startAt)) continue
          variants.push({
            ...base,
            start: startAt,
            end: shiftBy(base.end, offset),
            uid: uid && days.length > 1 ? `${uid}#${DAY_CODES[day]}` : uid,
            repeat: { weeks, until },
            exdates: [...new Set(exdates.filter((d) => weekday(d) === day))].sort(),
          })
        }
      }
    }
    for (const v of variants) {
      if (eventError(v)) {
        result.skipped++
        continue
      }
      result.events.push(v)
      if (uid && v.repeat) masters.set(uid, [...(masters.get(uid) ?? []), v])
    }
  }

  for (const { uid, date } of overrides) {
    for (const master of masters.get(uid) ?? []) {
      if (!master.exdates.includes(date)) master.exdates = [...master.exdates, date].sort()
    }
  }
  if (result.events.length > MAX_IMPORT_EVENTS) {
    result.skipped += result.events.length - MAX_IMPORT_EVENTS
    result.events = result.events.slice(0, MAX_IMPORT_EVENTS)
  }
  return result
}
