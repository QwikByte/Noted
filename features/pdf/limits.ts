// Grenzen für Anmerkungen in PDFs – prüft der Server, der Viewer richtet sich danach
import type { AnnotationColor } from './types'

/** Zeichen des markierten Textes */
export const MAX_QUOTE = 2_000
/** Zeichen eines Kommentars */
export const MAX_COMMENT = 5_000
/** Rechtecke einer Markierung (je Zeile eines) */
export const MAX_RECTS = 50
/** Anmerkungen je Anfrage (Offline gesammelte werden in Blöcken gesendet) */
export const MAX_ANNOTATIONS_PER_REQUEST = 500
/** Anmerkungen je PDF beim Import eines Exports */
export const MAX_IMPORTED_ANNOTATIONS = 5_000
/** Größe einer Anmerkungen-Datei im Export („Skript.pdf.anmerkungen.json“) beim Import */
export const MAX_ANNOTATIONS_FILE_BYTES = 20 * 1024 * 1024
/** Farbe für neue Markierungen: Gelb wie ein Textmarker */
export const DEFAULT_ANNOTATION_COLOR = 3

/**
 * Farben der Markierungen in einem heruntergeladenen PDF (RGB 0–255): kräftige Textmarker-Töne, die mit der
 * Deckkraft unten (wie im Viewer, multipliziert) auf weißem Papier so hell wirken wie dort – unabhängig vom Design
 */
export const ANNOTATION_RGB: Record<AnnotationColor, [number, number, number]> = {
  1: [240, 82, 70],
  2: [245, 150, 55],
  3: [255, 214, 0],
  4: [72, 196, 120],
  5: [56, 188, 212],
  6: [168, 118, 232],
}
export const ANNOTATION_OPACITY = 0.4
