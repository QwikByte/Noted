'use client'
// Den PDF-Viewer nach einem Update vorab laden, solange Verbindung besteht. Der Service Worker legt dabei seinen Code,
// pdf.js und den Worker im Offline-Speicher ab – sonst ginge der Viewer offline erst wieder, wenn er nach dem Update
// einmal online geöffnet wurde.
import { api } from '@/shared/client/api'
import { loadPdfjs } from './pdfjs'

const DONE_KEY = 'noted:pdfWarm'
/** Was pdf.js außer seinem Code braucht: den Worker und die Decoder für JPEG 2000, JBIG2 und Farbprofile */
const FILES = ['/pdfjs/pdf.worker.min.mjs', '/pdfjs/wasm/openjpeg.wasm', '/pdfjs/wasm/jbig2.wasm', '/pdfjs/wasm/qcms_bg.wasm']

/**
 * Einmal je Version (`buildId`), nur mit aktivem Service Worker und nur, wenn es PDFs gibt – sonst lüde jeder bei
 * jedem Update rund 1 MB umsonst. Klappt es nicht (z. B. Verbindung weg), beim nächsten Start erneut.
 */
export async function prewarmPdfViewer(buildId: string): Promise<void> {
  try {
    if (!navigator.serviceWorker?.controller || localStorage.getItem(DONE_KEY) === buildId) return
    const { attachments } = await api<{ attachments: { mime: string }[] }>('/api/attachments')
    // Offline kam die Liste aus dem Cache – nachladen ginge dann ohnehin nicht
    if (navigator.onLine === false) return
    if (attachments.some((a) => a.mime === 'application/pdf')) {
      await import('../components/PdfPanel')
      await loadPdfjs()
      await Promise.all(
        FILES.map(async (url) => {
          const res = await fetch(url)
          if (!res.ok) throw new Error(`${url}: ${res.status}`)
        }),
      )
    }
    localStorage.setItem(DONE_KEY, buildId)
  } catch {
    // Offline, Server startet neu oder Speicher voll – beim nächsten Start erneut
  }
}
