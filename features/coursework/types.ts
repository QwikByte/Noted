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

export type CourseworkData = { courses: Course[]; sheets: Sheet[] }

export type CourseInput = Pick<Course, 'name' | 'requiredPercent' | 'plannedSheets'>

/** Abgabe: YYYY-MM-DD (ohne Uhrzeit) oder YYYY-MM-DDTHH:mm, null = keine */
export type SheetInput = Pick<Sheet, 'title' | 'maxPoints' | 'points'> & { due: string | null }
