// Markierungen in PDFs: Umrechnung zwischen Bildschirm und PDF-Koordinaten, Zitate und Export.
// Reine Logik ohne DOM – der Viewer reicht Rechtecke und die Transformationsmatrix von pdf.js herein.
import { MAX_QUOTE, MAX_RECTS } from './limits'
import type { PdfAnnotation, PdfRect } from './types'

/** Rechteck auf dem Bildschirm, relativ zur linken oberen Ecke der Seite (CSS-Pixel) */
export type ViewRect = { left: number; top: number; width: number; height: number }

/**
 * Transformationsmatrix eines pdf.js-Viewports [a, b, c, d, e, f]: PDF-Punkt (x, y) → Bildschirm
 * (a·x + c·y + e, b·x + d·y + f). Enthält Zoom, Drehung und die nach unten zeigende y-Achse des Bildschirms.
 */
export type Transform = number[]

/** Bildschirm-Punkt → PDF-Koordinaten (Umkehrung der Transformation) */
export function toPdfPoint([a, b, c, d, e, f]: Transform, x: number, y: number): [number, number] {
  const det = a * d - b * c
  return [(d * (x - e) - c * (y - f)) / det, (a * (y - f) - b * (x - e)) / det]
}

function toViewPoint([a, b, c, d, e, f]: Transform, x: number, y: number): [number, number] {
  return [a * x + c * y + e, b * x + d * y + f]
}

const round = (n: number) => Math.round(n * 100) / 100

/** Bildschirm-Rechteck → PDF-Koordinaten (auf zwei Nachkommastellen) */
export function toPdfRect(transform: Transform, r: ViewRect): PdfRect {
  const [x1, y1] = toPdfPoint(transform, r.left, r.top)
  const [x2, y2] = toPdfPoint(transform, r.left + r.width, r.top + r.height)
  return [round(Math.min(x1, x2)), round(Math.min(y1, y2)), round(Math.max(x1, x2)), round(Math.max(y1, y2))]
}

/** PDF-Koordinaten → Bildschirm-Rechteck bei der aktuellen Ansicht */
export function toViewRect(transform: Transform, [x1, y1, x2, y2]: PdfRect): ViewRect {
  const [ax, ay] = toViewPoint(transform, x1, y1)
  const [bx, by] = toViewPoint(transform, x2, y2)
  return { left: Math.min(ax, bx), top: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) }
}

/**
 * Rechtecke einer Textauswahl (Range.getClientRects liefert eines je Textstück) zu einem je Zeile zusammenfassen:
 * Stücke, die sich vertikal größtenteils überlappen und waagrecht berühren, gehören zur selben Zeile.
 */
export function mergeLineRects(rects: ViewRect[]): ViewRect[] {
  const sorted = rects.filter((r) => r.width > 0.5 && r.height > 0.5).sort((a, b) => a.top - b.top || a.left - b.left)
  const lines: ViewRect[] = []
  for (const r of sorted) {
    const line = lines.find((l) => {
      const overlap = Math.min(l.top + l.height, r.top + r.height) - Math.max(l.top, r.top)
      const sameLine = overlap > Math.min(l.height, r.height) * 0.5
      const touching = r.left <= l.left + l.width + r.height && r.left + r.width >= l.left - r.height
      return sameLine && touching
    })
    if (!line) {
      lines.push({ ...r })
      continue
    }
    const right = Math.max(line.left + line.width, r.left + r.width)
    const bottom = Math.max(line.top + line.height, r.top + r.height)
    line.left = Math.min(line.left, r.left)
    line.top = Math.min(line.top, r.top)
    line.width = right - line.left
    line.height = bottom - line.top
  }
  return lines.slice(0, MAX_RECTS)
}

/** Markierter Text als Zitat: Leerraum bereinigt, auf MAX_QUOTE Zeichen gekürzt */
export function cleanQuote(text: string): string {
  const clean = text.replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim()
  return clean.length > MAX_QUOTE ? clean.slice(0, MAX_QUOTE - 1).trimEnd() + '…' : clean
}

/** Liegt der PDF-Punkt (x, y) in einer der Markierungen? Die oberste (zuletzt angelegte) gewinnt */
export function annotationAt<T extends Pick<PdfAnnotation, 'rects' | 'createdAt'>>(list: T[], x: number, y: number): T | null {
  const hits = list.filter((a) => a.rects.some(([x1, y1, x2, y2]) => x >= x1 && x <= x2 && y >= y1 && y <= y2))
  return hits.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
}

/** Reihenfolge wie im Dokument: nach Seite, dann von oben nach unten (PDF-y zeigt nach oben) */
export function sortAnnotations<T extends Pick<PdfAnnotation, 'page' | 'rects' | 'createdAt'>>(list: T[]): T[] {
  const top = (a: T) => Math.max(...a.rects.map((r) => r[3]))
  return [...list].sort((a, b) => a.page - b.page || top(b) - top(a) || a.createdAt - b.createdAt)
}

/** Markierungen eines PDFs als lesbare Markdown-Datei (Export) – Seite, Zitat, Kommentar */
export function annotationsMarkdown(filename: string, list: PdfAnnotation[]): string {
  const out = [`# Anmerkungen zu ${filename}`, '']
  let page = 0
  for (const a of sortAnnotations(list)) {
    if (a.page !== page) {
      page = a.page
      out.push(`## Seite ${page}`, '')
    }
    out.push(...a.quote.split('\n').map((l) => `> ${l}`), '')
    if (a.comment.trim()) out.push(a.comment.trim(), '')
  }
  return out.join('\n')
}
