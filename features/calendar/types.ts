// Kalender: Typen der API zwischen Server und Browser

/** Farbe eines Termins: 1–6 entspricht --swatch-1 … --swatch-6, null = Akzentfarbe */
export type EventColor = 1 | 2 | 3 | 4 | 5 | 6

export type EventRepeat = {
  /** Alle n Wochen (1 = wöchentlich) */
  weeks: number
  /** Letzter möglicher Tag (YYYY-MM-DD, einschließlich); null = ohne Ende */
  until: string | null
}

/** Klausur: Die verknüpften Karteikarten-Stapel werden bis zum Termin wiederholt */
export type EventExam = { deckIds: string[] }

/** Die bearbeitbaren Angaben eines Termins */
export type EventInput = {
  title: string
  location: string
  notes: string
  color: EventColor | null
  allDay: boolean
  /** Ortszeit ohne Zone: YYYY-MM-DDTHH:mm, ganztägig YYYY-MM-DD */
  start: string
  /** Wie start; ganztägig der Tag nach dem letzten Tag */
  end: string
  repeat: EventRepeat | null
  /** Ausgelassene Termine einer Serie (Tag des Beginns, YYYY-MM-DD) */
  exdates: string[]
  /** null = keine Klausur; Klausuren wiederholen sich nicht */
  exam: EventExam | null
}

export type CalendarEvent = EventInput & { id: string; createdAt: number; updatedAt: number }

/** Termin aus einer .ics-Datei – `uid` verhindert, dass ein zweiter Import ihn doppelt anlegt */
export type ImportedEvent = EventInput & { uid: string | null }

/** Ein Termin im Kalender – bei Serien eines ihrer Vorkommen */
export type Occurrence = {
  event: CalendarEvent
  /** Tag des Beginns dieses Vorkommens (bei Serien der Schlüssel für Ausnahmen) */
  date: string
  start: string
  end: string
}
