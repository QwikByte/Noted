// Klausurzulassung: Wie viele Punkte gibt es im Semester, wie viele sind nötig, und was fehlt noch?
// Sind noch nicht alle geplanten Blätter angelegt, zählen die fehlenden mit dem Durchschnitt der vorhandenen.
import type { Course, Sheet } from './types'

export type Admission = {
  /** Erreichbare Punkte im Semester (geschätzt, solange Blätter fehlen) */
  total: number
  estimated: boolean
  /** Für die Zulassung nötige Punkte */
  required: number
  /** Erreichte Punkte der korrigierten Blätter */
  achieved: number
  /** Noch fehlende Punkte */
  missing: number
  /** Noch nicht korrigierte oder noch nicht angelegte Blätter und ihre Punkte */
  openSheets: number
  openPoints: number
  state: 'empty' | 'reached' | 'open' | 'unreachable'
}

const round = (n: number) => Math.round(n * 100) / 100

export function admission(
  course: Pick<Course, 'requiredPercent' | 'plannedSheets'>,
  sheets: Pick<Sheet, 'maxPoints' | 'points'>[],
): Admission {
  const created = sheets.reduce((sum, s) => sum + s.maxPoints, 0)
  const notCreated = Math.max(0, (course.plannedSheets ?? 0) - sheets.length)
  const average = sheets.length > 0 ? created / sheets.length : 0
  const total = round(created + notCreated * average)
  const required = round((total * course.requiredPercent) / 100)
  const achieved = round(sheets.reduce((sum, s) => sum + (s.points ?? 0), 0))
  const ungraded = sheets.filter((s) => s.points === null)
  const openSheets = ungraded.length + notCreated
  const openPoints = round(ungraded.reduce((sum, s) => sum + s.maxPoints, 0) + notCreated * average)
  const missing = round(Math.max(0, required - achieved))
  const state = sheets.length === 0 ? 'empty' : missing === 0 ? 'reached' : missing > openPoints ? 'unreachable' : 'open'
  return { total, estimated: notCreated > 0, required, achieved, missing, openSheets, openPoints, state }
}

/** Punkte mit höchstens zwei Nachkommastellen: „7,5“ */
export const formatPoints = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 2 })

/** Hinweis wie „Noch 14 Punkte aus 4 Blättern nötig – im Schnitt 3,5 pro Blatt.“ */
export function admissionHint(a: Admission): string {
  const points = (n: number) => `${formatPoints(n)} ${n === 1 ? 'Punkt' : 'Punkte'}`
  switch (a.state) {
    case 'empty':
      return 'Noch keine Übungsblätter.'
    case 'reached':
      return `Zulassung erreicht: ${formatPoints(a.achieved)} von ${formatPoints(a.required)} nötigen Punkten.`
    case 'unreachable': {
      const missing = `Es ${a.missing === 1 ? 'fehlt' : 'fehlen'} ${points(a.missing)}`
      return a.openSheets === 0
        ? `Nicht erreicht: ${missing}, alle Blätter sind korrigiert.`
        : `Nicht mehr erreichbar: ${missing}, offen sind nur noch ${points(a.openPoints)}.`
    }
    default: {
      if (a.openSheets === 1) return `Noch ${points(a.missing)} aus 1 Blatt nötig.`
      // Auf halbe Punkte aufgerundet
      const perSheet = Math.ceil((a.missing / a.openSheets) * 2) / 2
      return `Noch ${points(a.missing)} aus ${a.openSheets} Blättern nötig – im Schnitt ${formatPoints(perSheet)} pro Blatt.`
    }
  }
}
