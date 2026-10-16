// HTML-Hilfen ohne DOM (laufen auf Server und im Browser): Escaping, Text aus HTML, einfache Dokumente.

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  shy: '',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  bdquo: '„',
  ldquo: '“',
  rdquo: '”',
  sbquo: '‚',
  lsquo: '‘',
  rsquo: '’',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß',
  euro: '€',
  copy: '©',
  reg: '®',
  deg: '°',
  middot: '·',
  times: '×',
}

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : m
    }
    return NAMED_ENTITIES[e] ?? m
  })
}

/** Elemente, nach denen eine neue Zeile beginnt */
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'dd', 'details', 'div', 'dl', 'dt', 'figcaption', 'figure', 'footer',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'section', 'summary', 'table',
  'tr', 'ul',
])
/** Elemente, deren Inhalt kein Text ist */
const SKIP_TAGS = new Set(['head', 'noscript', 'script', 'style', 'template', 'title'])

/** Position nach dem schließenden „>“ eines Tags (Anführungszeichen in Attributen werden beachtet) */
function tagEnd(html: string, from: number): number {
  let quote = ''
  for (let i = from; i < html.length; i++) {
    const c = html[i]
    if (quote) {
      if (c === quote) quote = ''
    } else if (c === '"' || c === "'") quote = c
    else if (c === '>') return i + 1
  }
  return -1
}

/**
 * Lesbarer Text aus HTML – für Suche, Auszüge, Tags, Links und Karteikarten. Blöcke werden zu Zeilen,
 * Code-Blöcke zu ```-Blöcken (damit Tags darin wie in Markdown ignoriert werden; abschaltbar mit codeFences).
 * Läuft in linearer Zeit: ein einziger Durchlauf statt Regex über das ganze Dokument.
 */
export function htmlToText(html: string, { codeFences = true }: { codeFences?: boolean } = {}): string {
  const lower = html.toLowerCase()
  const out: string[] = []
  let pre = 0
  let i = 0
  while (i < html.length) {
    const lt = html.indexOf('<', i)
    const textEnd = lt < 0 ? html.length : lt
    if (textEnd > i) {
      const text = decodeEntities(html.slice(i, textEnd))
      out.push(pre ? text : text.replace(/[ \t\r\n\f]+/g, ' '))
    }
    if (lt < 0) break
    if (lower.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt + 4)
      i = close < 0 ? html.length : close + 3
      continue
    }
    const end = tagEnd(html, lt + 1)
    if (end < 0) {
      out.push(html.slice(lt))
      break
    }
    i = end
    const m = /^<\s*(\/?)\s*([a-z][a-z0-9-]*)/.exec(lower.slice(lt, Math.min(end, lt + 40)))
    if (!m) continue // <!doctype …> oder ein einzelnes „<“
    const closing = m[1] === '/'
    const tag = m[2]
    if (!closing && SKIP_TAGS.has(tag)) {
      const close = lower.indexOf(`</${tag}`, i)
      const closeEnd = close < 0 ? -1 : tagEnd(html, close + 2)
      i = closeEnd < 0 ? html.length : closeEnd
      continue
    }
    if (tag === 'br') out.push('\n')
    else if (tag === 'pre') {
      pre = closing ? Math.max(0, pre - 1) : pre + 1
      out.push('\n```\n')
    } else if (tag === 'td' || tag === 'th') {
      if (!closing) out.push(' ')
    } else if (BLOCK_TAGS.has(tag)) out.push('\n')
  }

  // Zeilen außerhalb von Code-Blöcken bereinigen, mehrere Leerzeilen zusammenfassen
  const lines: string[] = []
  let inCode = false
  for (const raw of out.join('').split('\n')) {
    if (raw === '```') {
      inCode = !inCode
      if (!codeFences) continue
    }
    const line = inCode ? raw.replace(/\s+$/, '') : raw.trim()
    if (line === '' && (lines.length === 0 || lines[lines.length - 1] === '')) continue
    lines.push(line)
  }
  return lines.join('\n').trim()
}

/** Einfacher Text als HTML: Absätze an Leerzeilen, einzelne Zeilenumbrüche als <br> */
export function textToHtml(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n(?:[ \t]*\n)+/)
    .map((p) => p.replace(/^\n+|\n+$/g, ''))
    .filter((p) => p.trim() !== '')
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

/** Vollständiges HTML-Dokument, z. B. für Export und Download */
export function htmlDocument(title: string, body: string): string {
  return `<!doctype html>\n<html lang="de">\n<head>\n<meta charset="utf-8">\n<title>${escapeHtml(title)}</title>\n</head>\n<body>\n${body}\n</body>\n</html>\n`
}

/** Inhalt von <body> – bzw. alles, wenn es kein vollständiges Dokument ist */
export function htmlBody(html: string): string {
  const lower = html.toLowerCase()
  const open = lower.indexOf('<body')
  if (open < 0) return html.trim()
  const start = tagEnd(html, open + 1)
  if (start < 0) return ''
  const close = lower.lastIndexOf('</body')
  return html.slice(start, close >= start ? close : undefined).trim()
}
