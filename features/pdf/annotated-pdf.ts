// PDF mit den Markierungen aus Noted als echte PDF-Anmerkungen (/Highlight, Kommentar als Notiz) – zum Herunterladen,
// Ausdrucken oder Weitergeben. Reine Logik: pdf.js wird hereingereicht, damit es im Browser und im Test unter Node läuft.
import { highlightGeometry } from './geometry'
import { ANNOTATION_OPACITY, ANNOTATION_RGB } from './limits'
import type { PdfAnnotation } from './types'

type Pdfjs = Pick<typeof import('pdfjs-dist/legacy/build/pdf.mjs'), 'getDocument' | 'AnnotationEditorType'>

// Neue Anmerkungen übernimmt pdf.js beim Speichern nur unter Schlüsseln mit diesem Präfix (wie seine Editoren)
const EDITOR_PREFIX = 'pdfjs_internal_editor_'
// Größe des Notizfensters, das ein Reader für den Kommentar öffnet (wie bei pdf.js)
const POPUP_WIDTH = 180
const POPUP_HEIGHT = 100

/** „Skript.pdf“ → „Skript (mit Markierungen).pdf“ */
export function annotatedFileName(file: string): string {
  const name = file.split('/').pop() ?? file
  return name.replace(/(\.pdf)?$/i, ' (mit Markierungen).pdf')
}

/**
 * Markierungen in eine Kopie von `data` schreiben. Das Original bleibt unverändert; pdf.js speichert inkrementell, die
 * Datei wird also etwas größer. `options` wie bei getDocument (z. B. Pfade für Schriften im Browser).
 */
export async function addAnnotationsToPdf(
  pdfjs: Pdfjs,
  data: Uint8Array,
  annotations: PdfAnnotation[],
  options: object = {},
): Promise<Uint8Array> {
  // getDocument übergibt die Daten an den Worker und macht sie dabei unbrauchbar – daher eine Kopie
  const task = pdfjs.getDocument({ ...options, data: data.slice(), verbosity: 0 })
  try {
    let doc
    try {
      doc = await task.promise
    } catch (err) {
      const name = err instanceof Error ? err.name : ''
      if (name === 'PasswordException') throw new Error('Das PDF ist mit einem Passwort geschützt – Markierungen lassen sich nicht hineinschreiben.')
      if (name === 'InvalidPDFException') throw new Error('Das PDF ist beschädigt und lässt sich nicht bearbeiten.')
      throw err
    }
    annotations.forEach((a, i) => {
      if (a.page < 1 || a.page > doc.numPages || a.rects.length === 0) return
      const { rect, quadPoints, outlines } = highlightGeometry(a.rects)
      const comment = a.comment.trim()
      doc.annotationStorage.setValue(`${EDITOR_PREFIX}${i}`, {
        annotationType: pdfjs.AnnotationEditorType.HIGHLIGHT,
        pageIndex: a.page - 1,
        rect,
        quadPoints,
        outlines,
        color: ANNOTATION_RGB[a.color],
        opacity: ANNOTATION_OPACITY,
        rotation: 0,
        date: new Date(a.updatedAt),
        popup: comment
          ? { contents: comment, deleted: false, rect: [rect[2], rect[3] - POPUP_HEIGHT, rect[2] + POPUP_WIDTH, rect[3]] }
          : undefined,
      })
    })
    return await doc.saveDocument()
  } finally {
    await task.destroy()
  }
}
