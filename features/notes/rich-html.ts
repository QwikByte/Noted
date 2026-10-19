// Bausteine für formatierten Text (HTML): Anhänge, PDF-Links und Zitate – ohne den Editor selbst laden zu müssen.
import { defaultFileUrl } from '@/shared/markdown/syntax'
import { escapeHtml } from '@/shared/lib/html'
import type { Insertion, PdfRef } from './client/active-editor'
import type { Attachment } from '@/features/attachments/types'

const FILE_URL = '/api/files/'

function pdfLink(ref: PdfRef, label: string): string {
  return `<a href="${escapeHtml(defaultFileUrl(ref.file))}#page=${ref.page}">${escapeHtml(label)}</a>`
}

/** Seitenlink oder Zitat aus dem PDF-Viewer als HTML */
export function insertionToHtml(insertion: Insertion): string {
  const { ref } = insertion
  if (insertion.kind === 'page-link') return `<p>${pdfLink(ref, `${ref.file}, S. ${ref.page}`)}</p>`
  const text = escapeHtml(insertion.text).replace(/\n/g, '<br>')
  return `<blockquote><p>${text}<br>${pdfLink(ref, `S. ${ref.page}`)}</p></blockquote>`
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
