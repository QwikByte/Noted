// Grenzen für Anfragen an Claude – prüft der Server, der Dialog richtet sich danach.

/** Zeichen einer Notiz, die an Claude gehen (etwa 50 000 Tokens) */
export const MAX_AI_NOTE_CHARS = 200_000
/** Zeichen für die Wünsche zu den Karten („nur Definitionen“ …) */
export const MAX_AI_WISHES = 500
/** Höchstens so viele Karten schlägt Claude auf einmal vor */
export const MAX_AI_CARDS = 50
/** Vorhandene Karten der Notiz, die Claude zum Vermeiden von Doppeltem mitbekommt */
export const MAX_AI_EXISTING = 300
