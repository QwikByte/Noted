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
type Transform = number[]

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

/** Teil einer Textauswahl auf einer Seite: Text und Rechtecke in PDF-Koordinaten */
export type SelectionPart = { page: number; text: string; rects: PdfRect[] }

/**
 * Auswahl über eine oder mehrere Seiten: die Teile in Seitenfolge (ohne leere) und der Text aller Seiten. Fehlt eine
 * Seite dazwischen (pdf.js zeichnet den Text nur für sichtbare Seiten) oder gibt es keinen Teil, gilt `whole` – der
 * Text der ganzen Auswahl, wie ihn der Browser liefert.
 */
export function joinSelection(parts: SelectionPart[], whole: string): { text: string; parts: SelectionPart[] } {
  const sorted = parts.filter((p) => p.text.trim() || p.rects.length > 0).sort((a, b) => a.page - b.page)
  const gap = sorted.some((p, i) => i > 0 && p.page > sorted[i - 1].page + 1)
  const text = sorted.length === 0 || gap ? whole : sorted.map((p) => p.text).join('\n')
  return { text: text.replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim(), parts: sorted }
}

/** Textstück der Textebene einer Seite (Ausschnitt aus dem TextItem von pdf.js, Koordinaten der Seite) */
type TextPiece = { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean }

/**
 * Text unter einem aufgezogenen Bereich: die Stücke der Textebene, deren Mitte im Rechteck liegt – in der Reihenfolge
 * der Seite. Einträge ohne Text (Markierungen der Struktur) zählen nicht.
 */
export function textInRect(items: (TextPiece | object)[], [x1, y1, x2, y2]: PdfRect): string {
  let text = ''
  for (const item of items) {
    if (!('str' in item)) continue
    const [, , , , x, y] = item.transform
    const cx = x + item.width / 2
    const cy = y + item.height / 2
    if (cx < x1 || cx > x2 || cy < y1 || cy > y2) continue
    text += item.str + (item.hasEOL ? '\n' : '')
  }
  return text
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

/**
 * Rechtecke einer Markierung als Geometrie einer PDF-Anmerkung (/Highlight): die Hülle, QuadPoints (je Rechteck links
 * oben, rechts oben, links unten, rechts unten – wie pdf.js sie schreibt) und Umrisse für das Aussehen
 */
export function highlightGeometry(rects: PdfRect[]): { rect: PdfRect; quadPoints: number[]; outlines: number[][] } {
  const rect: PdfRect = [
    Math.min(...rects.map((r) => r[0])),
    Math.min(...rects.map((r) => r[1])),
    Math.max(...rects.map((r) => r[2])),
    Math.max(...rects.map((r) => r[3])),
  ]
  return {
    rect,
    quadPoints: rects.flatMap(([x1, y1, x2, y2]) => [x1, y2, x2, y2, x1, y1, x2, y1]),
    outlines: rects.map(([x1, y1, x2, y2]) => [x1, y1, x2, y1, x2, y2, x1, y2]),
  }
}

/** Reihenfolge wie im Dokument: nach Seite, dann von oben nach unten (PDF-y zeigt nach oben) */
export function sortAnnotations<T extends Pick<PdfAnnotation, 'page' | 'rects' | 'createdAt'>>(list: T[]): T[] {
  const top = (a: T) => Math.max(...a.rects.map((r) => r[3]))
  return [...list].sort((a, b) => a.page - b.page || top(b) - top(a) || a.createdAt - b.createdAt)
}

/** Markierungen eines PDFs als lesbare Markdown-Datei (Export) – Seite, Zitat bzw. „Bereich“, Kommentar */
export function annotationsMarkdown(filename: string, list: PdfAnnotation[]): string {
  const out = [`# Anmerkungen zu ${filename}`, '']
  let page = 0
  for (const a of sortAnnotations(list)) {
    if (a.page !== page) {
      page = a.page
      out.push(`## Seite ${page}`, '')
    }
    if (a.kind === 'area') out.push('_Bereich_', '')
    if (a.kind !== 'area' || a.quote) out.push(...a.quote.split('\n').map((l) => `> ${l}`), '')
    if (a.comment.trim()) out.push(a.comment.trim(), '')
  }
  return out.join('\n')
}
