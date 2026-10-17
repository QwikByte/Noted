// Datum und Uhrzeit als Text in Ortszeit (YYYY-MM-DD bzw. YYYY-MM-DDTHH:mm). Gerechnet wird mit der Uhrzeit, wie sie
// auf der Uhr steht – so bleibt eine Vorlesung um 10:15 auch nach der Zeitumstellung um 10:15.

const pad = (n: number) => String(n).padStart(2, '0')

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

const DAY_MS = 86_400_000

/** Uhrzeit als Zahl (als wäre sie UTC) – nur für Abstände und Verschiebungen */
export function wallMs(value: string): number {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number)
  const h = Number(value.slice(11, 13)) || 0
  const min = Number(value.slice(14, 16)) || 0
  return Date.UTC(y, m - 1, d, h, min)
}

export function fromWallMs(ms: number, withTime: boolean): string {
  const d = new Date(ms)
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  return withTime ? `${date}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : date
}

/** Gibt es den Tag bzw. die Uhrzeit wirklich (kein 31. Februar, keine 25 Uhr)? */
export function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  return fromWallMs(wallMs(value), false) === value
}

export function isValidDateTime(value: string): boolean {
  if (!DATETIME_RE.test(value)) return false
  return fromWallMs(wallMs(value), true) === value
}

export const dateOf = (value: string) => value.slice(0, 10)
export const timeOf = (value: string) => value.slice(11, 16)

export const addDays = (date: string, n: number) => fromWallMs(wallMs(date) + n * DAY_MS, false)
export const addMinutes = (value: string, n: number) => fromWallMs(wallMs(value) + n * 60_000, true)
export const daysBetween = (from: string, to: string) => Math.round((wallMs(to) - wallMs(from)) / DAY_MS)
export const minutesBetween = (from: string, to: string) => Math.round((wallMs(to) - wallMs(from)) / 60_000)

/** Wochentag: 0 = Montag … 6 = Sonntag */
export const weekday = (date: string) => (new Date(wallMs(date)).getUTCDay() + 6) % 7

export const startOfWeek = (date: string) => addDays(date, -weekday(date))

/** Kalenderwoche nach ISO 8601 – Woche 1 enthält den ersten Donnerstag des Jahres */
export function isoWeek(date: string): number {
  const thursday = addDays(date, 3 - weekday(date))
  return Math.floor(daysBetween(`${thursday.slice(0, 4)}-01-01`, thursday) / 7) + 1
}
export const startOfMonth = (date: string) => `${date.slice(0, 7)}-01`
export function addMonths(date: string, n: number): string {
  const [y, m] = date.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`
}

/** Heute bzw. jetzt in der Ortszeit des Geräts */
export const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const localDateTime = (d: Date) => `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`

const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

export const weekdayName = (date: string) => WEEKDAYS[weekday(date)]
export const weekdayShort = (date: string) => WEEKDAYS[weekday(date)].slice(0, 2)
export const monthName = (date: string) => MONTHS[Number(date.slice(5, 7)) - 1]
/** „19.10.“ */
export const shortDate = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}.`
/** „19.10.2026“ */
export const longDate = (date: string) => `${shortDate(date)}${date.slice(0, 4)}`
