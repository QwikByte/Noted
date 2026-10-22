// Termine mit Uhrzeit im Tagesraster: Position in Minuten und – bei Überschneidungen – nebeneinander
import { addDays, minutesBetween } from './dates'
import type { Occurrence } from './types'

type Placed = {
  occurrence: Occurrence
  /** Minuten ab 0:00 dieses Tages */
  top: number
  height: number
  /** Spalte innerhalb einer Gruppe sich überschneidender Termine */
  column: number
  columns: number
  /** Beginnt bzw. endet der Termin an einem anderen Tag? */
  continuesBefore: boolean
  continuesAfter: boolean
}

/** Mindesthöhe in Minuten, damit kurze Termine anklickbar bleiben */
const MIN_HEIGHT = 20

/** Termine mit Uhrzeit für einen Tag anordnen; Termine über Mitternacht werden an der Tagesgrenze abgeschnitten */
export function layoutDay(items: Occurrence[], day: string): Placed[] {
  const dayStart = `${day}T00:00`
  const dayEnd = `${addDays(day, 1)}T00:00`
  const segments = items
    .filter((o) => !o.event.allDay && o.start < dayEnd && (o.end > dayStart || (o.end === o.start && o.start >= dayStart)))
    .map((o) => {
      const top = Math.max(0, minutesBetween(dayStart, o.start))
      const bottom = Math.min(1440, minutesBetween(dayStart, o.end))
      return {
        occurrence: o,
        top,
        height: Math.max(MIN_HEIGHT, bottom - top),
        continuesBefore: o.start < dayStart,
        continuesAfter: o.end > dayEnd,
      }
    })
    .sort((a, b) => a.top - b.top || b.height - a.height)

  // Gruppen, die sich (auch über Ketten) überschneiden, teilen sich die Breite
  const placed: Placed[] = []
  let group: ((typeof segments)[number] & { column: number })[] = []
  let groupEnd = -1
  const flush = () => {
    const columns = Math.max(1, ...group.map((g) => g.column + 1))
    for (const g of group) placed.push({ ...g, columns })
    group = []
    groupEnd = -1
  }
  for (const s of segments) {
    if (group.length && s.top >= groupEnd) flush()
    const ends = new Map<number, number>()
    for (const g of group) ends.set(g.column, Math.max(ends.get(g.column) ?? 0, g.top + g.height))
    let column = 0
    while ((ends.get(column) ?? -1) > s.top) column++
    group.push({ ...s, column })
    groupEnd = Math.max(groupEnd, s.top + s.height)
  }
  if (group.length) flush()
  return placed
}
