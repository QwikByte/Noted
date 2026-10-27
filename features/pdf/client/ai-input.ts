'use client'
// Seiten und Markierungen eines PDFs für Claude: jede Seite als Bild (Formeln, Abbildungen, Scans) samt ihrem Text,
// markierte Bereiche als Ausschnitt.
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { blobToAiImage } from '@/features/ai/client/ai'
import { MAX_AI_PAGE_TEXT } from '@/features/ai/limits'
import type { AiImage, PdfMarkInput, PdfPageInput } from '@/features/ai/types'
import { releaseCanvas, renderPdfRegion } from './pdfjs'
import type { PdfAnnotation } from '../types'

/** Breite der Seitenbilder in Pixeln – reicht für Formeln und Fußnoten; größere verkleinert Claude ohnehin */
const PAGE_WIDTH = 1400

/** Text einer Seite, Zeilen wie im PDF */
export async function pageText(doc: PDFDocumentProxy, page: number): Promise<string> {
  const { items } = await (await doc.getPage(page)).getTextContent()
  const text = items.map((i) => ('str' in i ? i.str + (i.hasEOL ? '\n' : ' ') : '')).join('')
  return text.replace(/[ \t]+\n/g, '\n').trim().slice(0, MAX_AI_PAGE_TEXT)
}

/** Seite als JPEG */
export async function pageImage(doc: PDFDocumentProxy, page: number): Promise<AiImage> {
  const p = await doc.getPage(page)
  const base = p.getViewport({ scale: 1 })
  const viewport = p.getViewport({ scale: Math.min(3, PAGE_WIDTH / base.width) })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  try {
    const ctx = canvas.getContext('2d')
    // Weißer Grund: JPEG kennt keine Transparenz, leere Stellen würden sonst schwarz
    if (ctx) {
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    await p.render({ canvas, viewport }).promise
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8))
    if (!blob) throw new Error('Die Seite konnte nicht als Bild gespeichert werden.')
    return blobToAiImage(blob)
  } finally {
    releaseCanvas(canvas)
  }
}

/** Seiten mit Bild und Text */
export async function pagesForAi(doc: PDFDocumentProxy, pages: number[]): Promise<PdfPageInput[]> {
  const out: PdfPageInput[] = []
  // Nacheinander: Mehrere große Canvas gleichzeitig bringen Handys an ihre Speichergrenze
  for (const page of pages) out.push({ page, text: await pageText(doc, page), image: await pageImage(doc, page) })
  return out
}

/** Markierungen: Text mit Kommentar, bei Bereichen der Ausschnitt als Bild */
export async function marksForAi(
  doc: PDFDocumentProxy,
  annotations: Pick<PdfAnnotation, 'kind' | 'page' | 'rects' | 'quote' | 'comment'>[],
): Promise<PdfMarkInput[]> {
  const out: PdfMarkInput[] = []
  for (const a of annotations) {
    const image = a.kind === 'area' ? await blobToAiImage(await renderPdfRegion(doc, a.page, a.rects[0])) : undefined
    out.push({ page: a.page, quote: a.quote, comment: a.comment, image })
  }
  return out
}
