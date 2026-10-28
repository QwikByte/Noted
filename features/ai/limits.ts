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
/** Antworten, die Claude auf einmal bewertet (Aufgaben einer Probeklausur) */
export const MAX_AI_GRADE_ITEMS = 30
/** Zeichen je Frage, Musterlösung und Antwort beim Bewerten */
export const MAX_AI_ANSWER_CHARS = 20_000
/** Fragen bzw. Aufgaben, die Claude auf einmal stellt */
export const MAX_AI_QUESTIONS = 20
/** Stapel einer Probeklausur */
export const MAX_AI_EXAM_DECKS = 50
/** Fotos je Aufgabe einer Probeklausur */
export const MAX_AI_TASK_PHOTOS = 3
