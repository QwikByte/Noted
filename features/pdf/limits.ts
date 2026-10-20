// Grenzen für Anmerkungen in PDFs – prüft der Server, der Viewer richtet sich danach

/** Zeichen des markierten Textes */
export const MAX_QUOTE = 2_000
/** Zeichen eines Kommentars */
export const MAX_COMMENT = 5_000
/** Rechtecke einer Markierung (je Zeile eines) */
export const MAX_RECTS = 50
/** Anmerkungen je Anfrage (Offline gesammelte werden in Blöcken gesendet) */
export const MAX_ANNOTATIONS_PER_REQUEST = 500
/** Farbe für neue Markierungen: Gelb wie ein Textmarker */
export const DEFAULT_ANNOTATION_COLOR = 3
