'use client'
// pdf.js im Browser: Bibliothek bei Bedarf laden, PDF-Dateien öffnen und einzelne Seiten als Bild rendern
import { errorMessage } from '@/shared/client/api'
import { defaultFileUrl } from '@/shared/markdown/syntax'

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

const FILE_OFFLINE = 'Dieses PDF ist offline noch nicht verfügbar. Öffne es einmal mit Verbindung, danach geht es auch offline.'
export const VIEWER_OFFLINE = 'Der PDF-Viewer ist offline noch nicht bereit. Öffne ihn einmal mit Verbindung.'

const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false

/** Ganze Datei laden (statt Teilbereichen) – so landet sie im Offline-Cache des Service Workers */
export async function fetchPdf(file: string, signal?: AbortSignal): Promise<Uint8Array> {
  let res: Response
  try {
    res = await fetch(defaultFileUrl(file), { credentials: 'same-origin', signal })
  } catch (err) {
    if (offline() && !signal?.aborted) throw new Error(FILE_OFFLINE)
    throw err
  }
  // Offline und nicht im Cache des Service Workers
  if (res.headers.get('x-noted-offline') === '1') throw new Error(FILE_OFFLINE)
  if (!res.ok) throw new Error(res.status === 404 ? 'Die Datei wurde nicht gefunden.' : `Die Datei konnte nicht geladen werden (${res.status}).`)
  return new Uint8Array(await res.arrayBuffer())
}

/**
 * Meldung, wenn ein PDF nicht geöffnet werden kann. Offline fehlen sonst meist Dateien des Viewers (Code, pdf.js,
 * Worker) – statt der technischen, teils englischen Meldung ein Hinweis, was zu tun ist.
 */
export function pdfErrorMessage(err: unknown): string {
  const message = errorMessage(err)
  return offline() && message !== FILE_OFFLINE ? VIEWER_OFFLINE : message
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
  return renderPdfData(await fetchPdf(file), page, maxWidth)
}

/** Wie renderPdfPage, aber mit bereits geladener Datei; `type` z. B. image/jpeg für kleine Vorschaubilder */
export async function renderPdfData(
  data: Uint8Array,
  page: number,
  maxWidth: number,
  type = 'image/png',
): Promise<{ blob: Blob; pages: number }> {
  const { pdfjs } = await loadPdfjs()
  const task = pdfjs.getDocument({ data, ...DOCUMENT_OPTIONS })
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
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85))
    if (!blob) throw new Error('Die Seite konnte nicht als Bild gespeichert werden.')
    return { blob, pages: doc.numPages }
  } finally {
    void task.destroy()
  }
}
