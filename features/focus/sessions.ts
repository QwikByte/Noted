// Lernzeit pro Fach und Woche aus den gezählten Runden des Fokus-Timers. Reine Logik ohne Browser-Abhängigkeit.
import { localDate, startOfWeek } from '@/features/calendar/dates'
import type { FocusSession } from './types'

/** Fach in einheitlicher Schreibweise – Leerzeichen zusammengefasst */
export const cleanSubject = (s: string) => s.replace(/\s+/g, ' ').trim()

export type SubjectWeeks = {
  /** Fach wie zuletzt geschrieben; leer = ohne Fach */
  subject: string
  /** Lernzeit je Woche (ms), in der Reihenfolge von `weeks` */
  weeks: number[]
  total: number
}

/**
 * Lernzeit je Fach in den Wochen, die mit den Montagen in `weeks` beginnen (Ortszeit). Fächer werden ohne Rücksicht
 * auf Groß- und Kleinschreibung zusammengefasst; sortiert nach der Summe.
 */
export function weeklyBySubject(sessions: FocusSession[], weeks: string[]): SubjectWeeks[] {
  const index = new Map(weeks.map((w, i) => [w, i]))
  const rows = new Map<string, SubjectWeeks & { latest: number }>()
  for (const s of sessions) {
    const week = index.get(startOfWeek(localDate(new Date(s.startedAt))))
    if (week === undefined) continue
    const subject = cleanSubject(s.subject)
    const key = subject.toLocaleLowerCase('de')
    const row = rows.get(key) ?? { subject, weeks: weeks.map(() => 0), total: 0, latest: 0 }
    // Schreibweise der jüngsten Runde
    if (s.startedAt > row.latest) {
      row.subject = subject
      row.latest = s.startedAt
    }
    row.weeks[week] += s.durationMs
    row.total += s.durationMs
    rows.set(key, row)
  }
  return [...rows.values()]
    .sort((a, b) => b.total - a.total || a.subject.localeCompare(b.subject, 'de'))
    .map(({ subject, weeks: w, total }) => ({ subject, weeks: w, total }))
}

/** „45 min“, „2 h 05 min“ */
export function formatStudyTime(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`
}
