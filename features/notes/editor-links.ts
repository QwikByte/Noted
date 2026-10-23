// Links im Markdown-Editor: Was steht an einer Stelle – Wikilink, Datei, #Tag oder Adresse? Für Strg/⌘-Klick,
// Vorschau beim Überfahren und das Kontextmenü. Reine Logik ohne DOM.
import { isFileTarget, parseWikiTarget } from '@/shared/markdown/meta'
import { isProseAt } from './markdown-context'

export type EditorLink =
  | { kind: 'note'; target: string; heading: string | null }
  | { kind: 'file'; target: string; page: number | null }
  | { kind: 'tag'; tag: string }
  | { kind: 'url'; href: string }

const WIKILINK_RE = /!?\[\[([^[\]\n]{1,1000})\]\]/g
const MD_LINK_RE = /\[[^\]\n]*\]\((https?:\/\/[^)\s]+)\)/g
const URL_RE = /https?:\/\/[^\s<>()[\]]+/g
// Wie #Tags im Lesemodus (shared/markdown/syntax.ts): am Zeilenanfang oder nach Leerraum
const TAG_RE = /(^|\s)#([\p{L}\p{N}_\-/]+)/gu
const PDF_PAGE_RE = /^page=(\d{1,5})\b/i

/** Treffer von `re` in `line`, der die Stelle `offset` enthält (einschließlich des Zeichens direkt davor) */
function hitAt(line: string, offset: number, re: RegExp, skip: (m: RegExpMatchArray) => number = () => 0): RegExpMatchArray | null {
  for (const m of line.matchAll(re)) {
    const start = m.index + skip(m)
    if (offset >= start && offset <= m.index + m[0].length) return m
  }
  return null
}

/** Link in einer Zeile an der Stelle `offset` (0 = vor dem ersten Zeichen) */
export function linkAt(line: string, offset: number): EditorLink | null {
  const wiki = hitAt(line, offset, WIKILINK_RE)
  if (wiki) {
    const { target, heading } = parseWikiTarget(wiki[1])
    if (isFileTarget(target)) {
      const page = heading ? PDF_PAGE_RE.exec(heading)?.[1] : undefined
      return { kind: 'file', target, page: page ? Number(page) : null }
    }
    return { kind: 'note', target, heading }
  }
  const md = hitAt(line, offset, MD_LINK_RE)
  if (md) return { kind: 'url', href: md[1] }
  const url = hitAt(line, offset, URL_RE)
  // Satzzeichen am Ende gehören nicht zur Adresse
  if (url) return { kind: 'url', href: url[0].replace(/[.,;:!?'"]+$/, '') }
  const tag = hitAt(line, offset, TAG_RE, (m) => m[1].length)
  if (tag) {
    const name = tag[2].replace(/\/+$/, '')
    if (name && !/^[\d/]+$/.test(name)) return { kind: 'tag', tag: name.toLowerCase() }
  }
  return null
}

/** Link im Dokument an der Stelle `pos` – nicht in Properties, Code, Kommentaren und Formeln */
export function linkAtPos(doc: string, pos: number): EditorLink | null {
  const lineStart = doc.lastIndexOf('\n', pos - 1) + 1
  const lineEnd = doc.indexOf('\n', pos)
  const link = linkAt(doc.slice(lineStart, lineEnd < 0 ? doc.length : lineEnd), pos - lineStart)
  return link && isProseAt(doc, pos) ? link : null
}
