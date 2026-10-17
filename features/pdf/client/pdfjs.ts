'use client'
// pdf.js im Browser: Bibliothek bei Bedarf laden, PDF-Dateien öffnen und einzelne Seiten als Bild rendern
import { defaultFileUrl } from '@/shared/markdown/obsidian'

type Lib = { pdfjs: typeof import('pdfjs-dist/legacy/build/pdf.mjs'); viewer: typeof import('pdfjs-dist/legacy/web/pdf_viewer.mjs') }
let lib: Promise<Lib> | null = null

/**
 * pdf.js erst laden, wenn wirklich ein PDF geöffnet wird. Der Viewer erwartet die Bibliothek als globalThis.pdfjsLib.
 * „legacy“-Build: läuft auch in Browsern, denen neueste JavaScript-Funktionen fehlen (z. B. ältere Handys).
 */
export function loadPdfjs(): Promise<Lib> {
  lib ??= (async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs'
    const viewer = await import('pdfjs-dist/legacy/web/pdf_viewer.mjs')
    return { pdfjs, viewer }
  })()
  lib.catch(() => (lib = null))
  return lib
}

/** Ganze Datei laden (statt Teilbereichen) – so landet sie im Offline-Cache des Service Workers */
export async function fetchPdf(file: string, signal?: AbortSignal): Promise<Uint8Array> {
  const res = await fetch(defaultFileUrl(file), { credentials: 'same-origin', signal })
  if (!res.ok) throw new Error(res.status === 404 ? 'Die Datei wurde nicht gefunden.' : `Die Datei konnte nicht geladen werden (${res.status}).`)
  return new Uint8Array(await res.arrayBuffer())
}

/** Optionen für pdfjs.getDocument – Schriften, Farbprofile usw. liegen unter /pdfjs (scripts/vendor-pdfjs.mjs) */
export const DOCUMENT_OPTIONS = {
  enableXfa: false,
  cMapUrl: '/pdfjs/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/pdfjs/standard_fonts/',
  wasmUrl: '/pdfjs/wasm/',
  iccUrl: '/pdfjs/iccs/',
}

/** Eine Seite als PNG – höchstens `maxWidth` Pixel breit, scharf genug für Beschriftungen in Abbildungen */
export async function renderPdfPage(file: string, page: number, maxWidth = 1600): Promise<{ blob: Blob; pages: number }> {
  const { pdfjs } = await loadPdfjs()
  const task = pdfjs.getDocument({ data: await fetchPdf(file), ...DOCUMENT_OPTIONS })
  try {
    const doc = await task.promise
    if (page < 1 || page > doc.numPages) throw new Error(`Das PDF hat ${doc.numPages} ${doc.numPages === 1 ? 'Seite' : 'Seiten'}.`)
    const p = await doc.getPage(page)
    const base = p.getViewport({ scale: 1 })
    const viewport = p.getViewport({ scale: Math.min(3, maxWidth / base.width) })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    await p.render({ canvas, viewport }).promise
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Die Seite konnte nicht als Bild gespeichert werden.')
    return { blob, pages: doc.numPages }
  } finally {
    void task.destroy()
  }
}
