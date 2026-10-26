'use client'
// pdf.js im Browser: Bibliothek bei Bedarf laden, PDF-Dateien öffnen und einzelne Seiten als Bild rendern
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { errorMessage } from '@/shared/client/api'
import { inTurns } from '@/shared/lib/in-turns'
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

/**
 * Ganze Datei laden (statt Teilbereichen) – so landet sie im Offline-Cache des Service Workers. `onProgress` meldet
 * den Fortschritt, `total` ist null, wenn der Server die Größe nicht nennt.
 */
export async function fetchPdf(
  file: string,
  signal?: AbortSignal,
  onProgress?: (loaded: number, total: number | null) => void,
): Promise<Uint8Array> {
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
  if (!onProgress || !res.body) return new Uint8Array(await res.arrayBuffer())
  const total = Number(res.headers.get('content-length')) || null
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    onProgress(loaded, total)
  }
  const data = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.length
  }
  return data
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
  const { images, pages } = await renderPdfDataPages(data, [page], maxWidth, type)
  const image = images.get(page)
  if (!(image instanceof Blob)) throw image ?? new Error('Die Seite konnte nicht gerendert werden.')
  return { blob: image, pages }
}

/**
 * Mehrere Seiten einer Datei als Bilder – das PDF wird dabei nur einmal geöffnet. Je Seite das Bild oder der Fehler
 * (z. B. eine Seite, die es nicht gibt).
 */
export async function renderPdfDataPages(
  data: Uint8Array,
  pageNumbers: number[],
  maxWidth: number,
  type = 'image/png',
): Promise<{ images: Map<number, Blob | Error>; pages: number }> {
  const { pdfjs } = await loadPdfjs()
  const task = pdfjs.getDocument({ data, ...DOCUMENT_OPTIONS })
  try {
    const doc = await task.promise
    const images = new Map<number, Blob | Error>()
    for (const page of pageNumbers) {
      if (page < 1 || page > doc.numPages) {
        images.set(page, new Error(`Das PDF hat ${doc.numPages} ${doc.numPages === 1 ? 'Seite' : 'Seiten'}.`))
        continue
      }
      const p = await doc.getPage(page)
      const base = p.getViewport({ scale: 1 })
      const viewport = p.getViewport({ scale: Math.min(3, maxWidth / base.width) })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      await p.render({ canvas, viewport }).promise
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85))
      releaseCanvas(canvas)
      images.set(page, blob ?? new Error('Die Seite konnte nicht als Bild gespeichert werden.'))
    }
    return { images, pages: doc.numPages }
  } finally {
    void task.destroy()
  }
}

/** Miniaturen, die gleichzeitig gezeichnet werden – beim schnellen Scrollen durch ein langes Skript nicht alle auf einmal */
const thumbnailTurn = inTurns(2)

/**
 * Miniatur einer Seite in `canvas` zeichnen – aus dem schon geladenen Dokument, `width` in CSS-Pixeln. Liefert das
 * Seitenverhältnis (Höhe durch Breite). Mit `signal` abgebrochen (nicht mehr sichtbar), wird nicht oder nicht weiter
 * gezeichnet.
 */
export function renderThumbnail(
  doc: PDFDocumentProxy,
  page: number,
  canvas: HTMLCanvasElement,
  width: number,
  signal: AbortSignal,
): Promise<number | null> {
  return thumbnailTurn(async () => {
    if (signal.aborted) return null
    const p = await doc.getPage(page)
    if (signal.aborted) return null
    const base = p.getViewport({ scale: 1 })
    // Scharf auf hochauflösenden Bildschirmen, aber nicht größer als nötig – der Speicher für Canvas ist auf Handys knapp
    const viewport = p.getViewport({ scale: (width * Math.min(2, window.devicePixelRatio || 1)) / base.width })
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const task = p.render({ canvas, viewport })
    const cancel = () => task.cancel()
    signal.addEventListener('abort', cancel)
    try {
      await task.promise
    } catch (err) {
      if (!signal.aborted) throw err
    } finally {
      signal.removeEventListener('abort', cancel)
    }
    return base.height / base.width
  })
}

/** Gezeichnete Miniatur freigeben (nicht mehr sichtbar, Seitenleiste zu, anderes PDF) */
export function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0
  canvas.height = 0
}
