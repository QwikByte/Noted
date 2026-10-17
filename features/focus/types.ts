// Fokus-Timer: Typen der API zwischen Server und Browser

/** Gezählte Runde des Fokus-Timers – die ID vergibt das Gerät (offline gesammelt, später gesendet) */
export type FocusSession = {
  id: string
  /** Fach, freier Text („Analysis I“) – leer, wenn keins angegeben war */
  subject: string
  /** Ziel der Runde („Kapitel 3“), optional */
  goal: string
  startedAt: number
  durationMs: number
}

export type FocusSessionData = {
  /** Runden der letzten Wochen */
  sessions: FocusSession[]
  /** Zuletzt benutzte Fächer (für Vorschläge) */
  subjects: string[]
}
