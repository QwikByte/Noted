import 'server-only'
// Text aus Anhängen für die Volltextsuche: PDFs seitenweise über pdf.js, Textdateien direkt
import { INDEX_MAX_CHARS, INDEX_MAX_PAGES, INDEX_TIMEOUT_MS } from '../limits'

const TEXT_MIMES = new Set(['text/plain', 'text/csv', 'text/markdown'])

/** Dateien, deren Text durchsucht wird – Office-Formate bräuchten weitere Pakete */
export const isSearchable = (mime: string) => mime === 'application/pdf' || TEXT_MIMES.has(mime)

/** pages: Text je Seite (Textdateien: eine Seite), truncated: Hinweis, falls gekürzt · skipped: Grund */
export type Extracted = { pages: string[]; truncated: string | null } | { skipped: string }

const TOO_BIG: Extracted = { skipped: 'zu groß' }
const NO_TEXT: Extracted = { skipped: 'kein Text gefunden' }

type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
let pdfjs: Promise<Pdfjs> | null = null

/**
 * pdf.js in Node: Der „Worker“ läuft im selben Prozess. Er wird vorab geladen, sonst würde pdf.js ihn selbst über
 * einen Dateipfad nachladen, den der Build nicht kennt.
 */
function loadPdfjs(): Promise<Pdfjs> {
  pdfjs ??= (async () => {
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
    Object.assign(globalThis, { pdfjsWorker: worker })
    return import('pdfjs-dist/legacy/build/pdf.mjs')
  })()
  pdfjs.catch(() => (pdfjs = null))
  return pdfjs
}

/** Steuerzeichen entfernen (außer Tab und Zeilenumbruch) – \u0002 und \u0003 markieren in der Suche die Treffer */
const clean = (text: string) => text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ')

/**
 * Text einer Datei für die Volltextsuche. Wirft nicht: Unlesbare oder zu große Dateien kommen als `skipped` zurück.
 * PDFs: höchstens INDEX_MAX_PAGES Seiten und INDEX_TIMEOUT_MS Zeit; insgesamt höchstens INDEX_MAX_CHARS Zeichen.
 */
export async function extractText(
  mime: string,
  data: Uint8Array,
  opts: { timeoutMs?: number } = {},
): Promise<Extracted> {
  if (TEXT_MIMES.has(mime)) return textFile(data)
  if (mime === 'application/pdf') return pdfFile(data, opts.timeoutMs ?? INDEX_TIMEOUT_MS)
  return { skipped: 'Dateityp wird nicht durchsucht' }
}

function textFile(data: Uint8Array): Extracted {
  // Mehr als 4 Byte je Zeichen braucht UTF-8 nicht – der Rest würde ohnehin abgeschnitten
  const head = data.subarray(0, INDEX_MAX_CHARS * 4)
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: head.length < data.length })
  } catch {
    // Kein gültiges UTF-8: ältere Textdateien und CSV-Exporte aus Excel sind meist Windows-1252
    text = new TextDecoder('windows-1252').decode(head)
  }
  if (text.includes('\u0000')) return NO_TEXT
  const truncated = text.length > INDEX_MAX_CHARS || head.length < data.length
  text = clean(text.slice(0, INDEX_MAX_CHARS))
  if (!text.trim()) return NO_TEXT
  return { pages: [text], truncated: truncated ? 'nur die ersten 2 MB Text' : null }
}

async function pdfFile(data: Uint8Array, timeoutMs: number): Promise<Extracted> {
  const { getDocument, VerbosityLevel } = await loadPdfjs()
  // pdf.js übernimmt den Speicher der Daten – daher eine Kopie
  const task = getDocument({
    data: new Uint8Array(data),
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    verbosity: VerbosityLevel.ERRORS,
  })
  const deadline = Date.now() + timeoutMs
  try {
    const doc = await task.promise
    if (Date.now() >= deadline) return TOO_BIG
    const pages: string[] = []
    const count = Math.min(doc.numPages, INDEX_MAX_PAGES)
    let chars = 0
    let truncated = doc.numPages > INDEX_MAX_PAGES ? `nur die ersten ${INDEX_MAX_PAGES} Seiten` : null
    for (let n = 1; n <= count; n++) {
      // pdf.js rechnet im selben Thread und gibt dabei nie an die Ereignisschleife ab – zwischen den Seiten
      // kommen daher andere Anfragen an die Reihe
      await new Promise((resolve) => setImmediate(resolve))
      if (Date.now() >= deadline) return TOO_BIG
      const content = await (await doc.getPage(n)).getTextContent()
      let text = clean(content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : '')).join(''))
      if (chars + text.length > INDEX_MAX_CHARS) {
        text = text.slice(0, INDEX_MAX_CHARS - chars)
        truncated = 'nur die ersten 2 MB Text'
      }
      pages.push(text)
      chars += text.length
      if (chars >= INDEX_MAX_CHARS) break
    }
    // Gescannte Seiten ohne Textebene
    if (pages.every((p) => !p.trim())) return NO_TEXT
    return { pages, truncated }
  } catch (err) {
    console.error('[noted] PDF konnte nicht gelesen werden:', err instanceof Error ? err.message : err)
    return { skipped: err instanceof Error && err.name === 'PasswordException' ? 'mit Passwort geschützt' : 'nicht lesbar' }
  } finally {
    await task.destroy()
  }
}
