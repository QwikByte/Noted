// Typen für Anmerkungen in PDFs (API-Verträge zwischen Server und Browser)

/**
 * Rechteck in PDF-Koordinaten der Seite: [x1, y1, x2, y2] in Punkten, Ursprung unten links – unabhängig von Zoom und
 * Gerät, daher sitzt eine Markierung überall an derselben Textstelle
 */
export type PdfRect = [number, number, number, number]

/** Farbe wie im Kalender: 1 Rot, 2 Orange, 3 Gelb, 4 Grün, 5 Türkis, 6 Lila */
export type AnnotationColor = 1 | 2 | 3 | 4 | 5 | 6

/** text: markierter Text (ein Rechteck je Zeile) · area: aufgezogener Bereich (genau ein Rechteck), z. B. in Scans */
export type AnnotationKind = 'text' | 'area'

/**
 * Markierte Textstelle oder markierter Bereich in einem PDF – optional mit Kommentar. Die ID vergibt der Browser (auch
 * offline).
 */
export type PdfAnnotation = {
  id: string
  attachmentId: string
  kind: AnnotationKind
  page: number
  rects: PdfRect[]
  quote: string
  comment: string
  color: AnnotationColor
  createdAt: number
  updatedAt: number
}
