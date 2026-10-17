// Übungen und Klausurzulassung: Typen der API zwischen Server und Browser

/** Ein Fach mit Übungsbetrieb, z. B. „Analysis I“ */
export type Course = {
  id: string
  name: string
  /** Für die Zulassung nötiger Anteil der Übungspunkte (0–100) */
  requiredPercent: number
  /** Übungsblätter im ganzen Semester, falls bekannt – sonst zählen nur die angelegten */
  plannedSheets: number | null
  createdAt: number
  updatedAt: number
}

export type Sheet = {
  id: string
  courseId: string
  title: string
  maxPoints: number
  /** Erreichte Punkte (auch mehr als maxPoints, z. B. mit Zusatzpunkten); null = noch nicht korrigiert */
  points: number | null
  /** Abgabe als Termin im Kalender – Tag und Uhrzeit stehen dort */
  eventId: string | null
  createdAt: number
  updatedAt: number
}

/** Ergebnis einer Bearbeitung: gelöst, unsicher oder falsch */
export type TaskResult = 'solved' | 'unsure' | 'wrong'

/** Aufgabe zum Wiederholen, z. B. aus einer Altklausur – Text und Lösung in Markdown */
export type CourseTask = {
  id: string
  courseId: string
  title: string
  prompt: string
  solution: string
  /** Ergebnis der letzten Bearbeitung – null = noch nicht bearbeitet */
  result: TaskResult | null
  attempts: number
  /** Nächste Wiederholung (YYYY-MM-DD) – nur bei unsicher und falsch */
  due: string | null
  attemptedAt: number | null
  createdAt: number
  updatedAt: number
}

export type CourseworkData = { courses: Course[]; sheets: Sheet[]; tasks: CourseTask[] }

export type CourseInput = Pick<Course, 'name' | 'requiredPercent' | 'plannedSheets'>

/** Abgabe: YYYY-MM-DD (ohne Uhrzeit) oder YYYY-MM-DDTHH:mm, null = keine */
export type SheetInput = Pick<Sheet, 'title' | 'maxPoints' | 'points'> & { due: string | null }

export type TaskInput = Pick<CourseTask, 'title' | 'prompt' | 'solution'>
