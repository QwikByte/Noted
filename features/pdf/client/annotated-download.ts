'use client'
// PDF mit Markierungen im Browser erzeugen und als Datei speichern – die Originaldatei auf dem Server bleibt, wie sie ist
import { addAnnotationsToPdf, annotatedFileName } from '../annotated-pdf'
import { DOCUMENT_OPTIONS, fetchPdf, loadPdfjs } from './pdfjs'
import type { PdfAnnotation } from '../types'

export async function downloadAnnotatedPdf(file: string, annotations: PdfAnnotation[]): Promise<void> {
  const [{ pdfjs }, data] = await Promise.all([loadPdfjs(), fetchPdf(file)])
  const bytes = await addAnnotationsToPdf(pdfjs, data, annotations, DOCUMENT_OPTIONS)
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = annotatedFileName(file)
  a.click()
  // Erst später freigeben – manche Browser lesen die Datei nach dem Klick noch
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
