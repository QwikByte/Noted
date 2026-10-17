// Kalender: Typen der API zwischen Server und Browser

export type CalendarInfo = {
  id: string
  name: string
  /** Farbe aus Outlook (#rrggbb) */
  color: string | null
  isDefault: boolean
  /** Termine dieses Kalenders erscheinen im Dashboard */
  selected: boolean
}

export type CalendarStatus =
  /** Der Admin hat die Microsoft-Anbindung nicht eingerichtet */
  | { configured: false; connected: false }
  | { configured: true; connected: false }
  | {
      configured: true
      connected: true
      account: { name: string; email: string }
      calendars: CalendarInfo[]
      /** Hinweis, wenn die Verbindung erneuert werden muss oder Microsoft nicht erreichbar ist */
      error: string | null
    }

export type CalendarEvent = {
  id: string
  calendarId: string
  subject: string
  /** Zeitpunkt in UTC (ISO); bei ganztägigen Terminen nur das Datum (YYYY-MM-DD) */
  start: string
  /** Wie start; bei ganztägigen Terminen der Tag nach dem letzten Tag */
  end: string
  allDay: boolean
  location: string | null
  /** Link zur Online-Besprechung (z. B. Teams) */
  joinUrl: string | null
  color: string | null
}

/** Längster Zeitraum, den das Dashboard auf einmal abfragt */
export const MAX_RANGE_DAYS = 62
