// Bausteine für formatierten Text (HTML): Anhänge, PDF-Links und Zitate – ohne den Editor selbst laden zu müssen.
import { defaultFileUrl } from '@/shared/markdown/syntax'
import { escapeHtml, htmlToText } from '@/shared/lib/html'
import type { Insertion, PdfRef } from './client/active-editor'
import type { Attachment } from '@/features/attachments/types'

const FILE_URL = '/api/files/'

/** Überschriften, die der Editor kennt – h4 bis h6 aus eingefügtem HTML werden zu Absätzen */
export const RICH_HEADING_LEVELS = [1, 2, 3] as const

/**
 * Überschriften 1–3 in der Reihenfolge des Dokuments – auch leere, damit die Nummern zu den Überschriften im DOM
 * passen. Linear: öffnendes Tag suchen, das schließende per indexOf ab dort
 */
export function richTextHeadings(html: string): { level: number; text: string }[] {
  const lower = html.toLowerCase()
  const out: { level: number; text: string }[] = []
  // Fehlt ein schließendes Tag einmal, fehlt es auch für alle späteren Überschriften dieser Ebene
  const unclosed = new Set<number>()
  const open = /<h([1-3])(?=[\s/>])/g
  let m: RegExpExecArray | null
  while ((m = open.exec(lower))) {
    const level = Number(m[1])
    const start = lower.indexOf('>', open.lastIndex)
    if (start < 0) break
    const close = unclosed.has(level) ? -1 : lower.indexOf(`</h${level}`, start)
    if (close < 0) {
      unclosed.add(level)
      out.push({ level, text: '' })
      continue
    }
    out.push({ level, text: htmlToText(html.slice(start + 1, close)).replace(/\s+/g, ' ') })
    open.lastIndex = close
  }
  return out
}

function pdfLink(ref: PdfRef, label: string): string {
  return `<a href="${escapeHtml(defaultFileUrl(ref.file))}#page=${ref.page}">${escapeHtml(label)}</a>`
}

/** Seitenlink oder Zitat aus dem PDF-Viewer als HTML */
export function insertionToHtml(insertion: Insertion): string {
  if (insertion.kind === 'page-link') {
    const { ref } = insertion
    return `<p>${pdfLink(ref, `${ref.file}, S. ${ref.page}`)}</p>`
  }
  const quotes = insertion.kind === 'quotes' ? insertion.quotes : [insertion]
  return quotes
    .map(({ text, ref }) => `<blockquote><p>${escapeHtml(text).replace(/\n/g, '<br>')}<br>${pdfLink(ref, `S. ${ref.page}`)}</p></blockquote>`)
    .join('')
}

/** Bilder eingebettet, alle anderen Dateien als Link */
export function attachmentHtml(att: Pick<Attachment, 'filename' | 'mime'>): string {
  const url = escapeHtml(defaultFileUrl(att.filename))
  if (att.mime.startsWith('image/')) return `<img src="${url}" alt="${escapeHtml(att.filename)}">`
  return `<p><a href="${url}">${escapeHtml(att.filename)}</a></p>`
}

/** Anhang hinter einer URL aus dem Editor, z. B. „/api/files/Skript.pdf#page=3“ */
export function attachmentFromUrl(href: string): { name: string; page: number | null } | null {
  if (!href.startsWith(FILE_URL)) return null
  const [path, hash = ''] = href.slice(FILE_URL.length).split('#')
  try {
    const name = path.split('/').map(decodeURIComponent).join('/')
    const page = /^page=(\d{1,5})$/.exec(hash)?.[1]
    return { name, page: page ? Number(page) : null }
  } catch {
    return null
  }
}

/** Namen der PDFs, die in formatiertem Text verlinkt oder eingebettet sind */
export function linkedPdfs(html: string): string[] {
  const names = new Set<string>()
  for (const m of html.matchAll(/\s(?:href|src)="(\/api\/files\/[^"]+)"/gi)) {
    const file = attachmentFromUrl(m[1].replace(/&amp;/g, '&'))
    if (file && /\.pdf$/i.test(file.name)) names.add(file.name)
  }
  return [...names]
}
