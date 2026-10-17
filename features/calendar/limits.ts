// Grenzwerte für Termine – Server und Browser prüfen dieselben

export const MAX_TITLE = 300
export const MAX_LOCATION = 300
export const MAX_NOTES = 10_000
/** Höchstens alle 52 Wochen */
export const MAX_REPEAT_WEEKS = 52
export const MAX_EXDATES = 1000
/** So viele Termine nimmt ein .ics-Import auf einmal an */
export const MAX_IMPORT_EVENTS = 5000
/** Länge der Kennung (UID) aus einer .ics-Datei */
export const MAX_UID = 1000
/** So viele Stapel lassen sich mit einer Klausur verknüpfen */
export const MAX_EXAM_DECKS = 100
