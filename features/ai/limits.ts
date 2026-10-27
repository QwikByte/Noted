// Grenzen für Anfragen an Claude – prüft der Server, die Oberfläche richtet sich danach.

/** Zeichen einer Notiz bzw. eines Textes, die an Claude gehen (etwa 50 000 Tokens) */
export const MAX_AI_NOTE_CHARS = 200_000
/** Zeichen für die Wünsche zu den Karten („nur Definitionen“ …) und für Aufträge an den Assistenten */
export const MAX_AI_WISHES = 2_000
/** Höchstens so viele Karten schlägt Claude auf einmal vor */
export const MAX_AI_CARDS = 50
/** Vorhandene Karten, die Claude zum Vermeiden von Doppeltem mitbekommt */
export const MAX_AI_EXISTING = 300
/** PDF-Seiten je Anfrage */
export const MAX_AI_PDF_PAGES = 20
/** Markierungen eines PDFs je Anfrage */
export const MAX_AI_MARKS = 300
/** Bilder (Seiten, Bereiche) je Anfrage */
export const MAX_AI_IMAGES = 24
/** Größe eines Bildes als base64 – etwa 1,5 MB, eine Seite als JPEG braucht meist ein paar Hundert KB */
export const MAX_AI_IMAGE_CHARS = 2_000_000
/** Zeichen Text je PDF-Seite */
export const MAX_AI_PAGE_TEXT = 20_000
