// Auswertung von Markdown: Frontmatter (Properties), Tags und Wikilinks.
import { parse as parseYaml } from 'yaml'

const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/

type Frontmatter = { raw: string; data: Record<string, unknown> | null; body: string; lines: number }

/** Trennt YAML-Frontmatter (muss in Zeile 1 beginnen) vom Inhalt. */
export function splitFrontmatter(content: string): Frontmatter | null {
  const m = FRONTMATTER_RE.exec(content)
  if (!m) return null
  let data: Record<string, unknown> | null = null
  try {
    const parsed = m[1].trim() ? parseYaml(m[1]) : {}
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>
  } catch {
    data = null
  }
  return { raw: m[1], data, body: content.slice(m[0].length), lines: m[0].split('\n').length - 1 }
}

const blank = (s: string) => s.replace(/[^\n]/g, ' ')
const FENCE_RE = /^[ \t]*(`{3,}|~{3,})/

/**
 * Code-Blöcke und Kommentare durch Leerzeichen ersetzen (Zeilen bleiben erhalten).
 * Bewusst zeilenweise statt mit einer großen Regex – sonst droht quadratische Laufzeit.
 */
function stripBlocks(text: string): string {
  const lines = text.split('\n')
  let fence: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE_RE.exec(lines[i])
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null
      lines[i] = blank(lines[i])
    } else if (m) {
      fence = m[1]
      lines[i] = blank(lines[i])
    }
  }
  return lines.join('\n').replace(/%%[\s\S]*?%%/g, blank)
}

/** Code-Blöcke, Inline-Code und Kommentare durch Leerzeichen ersetzen (Zeilen bleiben erhalten). */
export function stripCode(text: string): string {
  return stripBlocks(text).replace(/(`+)[^`\n][\s\S]*?\1/g, blank)
}

/** Inline-Markdown als Klartext: ohne Einbettungen, Links als ihr Text, ohne Formatierungszeichen */
function plainInline(text: string): string {
  return text
    .replace(/!\[\[[^[\]\n]*\]\]/g, ' ')
    .replace(/\[\[([^[\]|\n]*\|)?([^[\]\n]*)\]\]/g, '$2')
    .replace(/!?\[([^[\]\n]*)\]\([^()\n]*\)/g, '$1')
    .replace(/[*_~=`$]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Vergleichsform einer Überschrift – nur Buchstaben und Ziffern, damit Formatierung und Satzzeichen nicht stören */
export const headingKey = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

type MarkdownHeading = {
  level: number
  /** Klartext wie in Auszügen, z. B. für die Gliederung */
  text: string
  /** Text, wie er geschrieben steht – ohne # bzw. Unterstreichung */
  raw: string
  /** Zeile (0-basiert, inklusive Frontmatter); bei Setext die erste Zeile des Absatzes */
  line: number
}

const ATX_RE = /^ {0,3}(#{1,6})(?:[ \t](.*))?$/
const SETEXT_RE = /^ {0,3}(=+|-+)[ \t]*$/
const BREAK_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const INDENTED_RE = /^(?: {4}| {0,3}\t)/
const HTML_RE = /^ {0,3}<[a-zA-Z/!?]/
const BLOCK_RE = /^ {0,3}(?:>|[-*+](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$))/
// Zitate und Listen beenden einen Absatz – geordnete aber nur ab 1 und keine leeren Punkte (wie markdown-it)
const INTERRUPT_RE = /^ {0,3}(?:>|[-*+][ \t]+\S|1[.)][ \t]+\S)/
// Inline-Code und Formeln bleiben als Quelltext stehen, nur ohne Backticks und $
const VERBATIM_RE = /(`+)([^`]+)\1|\$\$([^$]+)\$\$|\$([^$]+)\$/g

/** Text einer ATX-Überschrift ohne schließende # – die zählen nur nach Leerraum („Einführung in C#“) */
function atxText(rest: string): string {
  const s = rest.trim()
  let end = s.length
  while (end > 0 && s[end - 1] === '#') end--
  if (end === 0) return ''
  return end < s.length && (s[end - 1] === ' ' || s[end - 1] === '\t') ? s.slice(0, end).trimEnd() : s
}

function headingText(raw: string): string {
  const verbatim: string[] = []
  const masked = raw.replace(VERBATIM_RE, (_m, _ticks, code?: string, block?: string, inline?: string) => {
    verbatim.push(code ?? block ?? inline ?? '')
    return `\uE000${verbatim.length - 1}\uE001`
  })
  return plainInline(masked)
    .replace(/\uE000(\d+)\uE001/g, (m, i: string) => verbatim[Number(i)] ?? m)
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Überschriften (ATX und Setext) außerhalb von Frontmatter, Code-Blöcken, Kommentaren, Zitaten und Callouts.
 * Ein Durchlauf über die Zeilen ohne Rückwärtssuche, damit es auch bei jedem Tastendruck reicht.
 */
export function findHeadings(content: string): MarkdownHeading[] {
  const fm = splitFrontmatter(content)
  const offset = fm ? fm.lines : 0
  const lines = stripBlocks((fm ? fm.body : content).replace(/\r\n?/g, '\n')).split('\n')
  const out: MarkdownHeading[] = []
  const push = (level: number, raw: string, line: number) => {
    const text = headingText(raw)
    if (text) out.push({ level, text, raw, line: offset + line })
  }
  // Laufender Absatz, der noch zur Setext-Überschrift werden kann
  let para: string[] = []
  let paraLine = -1
  // Ein Absatz beginnt nur am Anfang, nach einer Leerzeile, Überschrift oder einem Trennstrich – nicht in Listen
  // und Zitaten, deren Folgezeilen bis zur Leerzeile dazugehören
  let mayStart = true
  let html = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) {
      paraLine = -1
      mayStart = true
      html = false
      continue
    }
    if (html) continue
    const atx = ATX_RE.exec(line)
    if (atx) {
      push(atx[1].length, atxText(atx[2] ?? ''), i)
      paraLine = -1
      mayStart = true
    } else if (paraLine >= 0) {
      const setext = SETEXT_RE.exec(line)
      if (setext) push(setext[1][0] === '=' ? 1 : 2, para.join(' '), paraLine)
      if (setext || BREAK_RE.test(line)) paraLine = -1
      else if (INTERRUPT_RE.test(line)) {
        paraLine = -1
        mayStart = false
      } else para.push(line.trim())
    } else if (BREAK_RE.test(line)) mayStart = true
    else if (!mayStart || INDENTED_RE.test(line)) continue
    else if (HTML_RE.test(line)) html = true
    else if (BLOCK_RE.test(line)) mayStart = false
    else {
      para = [line.trim()]
      paraLine = i
    }
  }
  return out
}

/** Zeile (0-basiert) der ersten Überschrift mit diesem Text (roh oder als Klartext), z. B. für [[Notiz#Abschnitt]] */
export function findHeadingLine(content: string, heading: string): number | null {
  const key = headingKey(heading)
  if (!key) return null
  return findHeadings(content).find((h) => headingKey(h.raw) === key || headingKey(h.text) === key)?.line ?? null
}

const INLINE_TAG_RE = /(^|\s)#([\p{L}\p{N}_\-/]+)/gu

function normalizeTag(tag: string): string | null {
  const t = tag.trim().replace(/^#+/, '').replace(/\/+$/, '').toLowerCase()
  if (!t || !/^[\p{L}\p{N}_\-/]+$/u.test(t)) return null
  if (/^[\d/]+$/.test(t)) return null // rein numerisch ist kein Tag
  return t
}

function frontmatterList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v) => v != null).map(String)
  if (typeof value === 'string') return value.split(/[,\s]+/)
  return []
}

export function extractTags(content: string): string[] {
  const tags = new Set<string>()
  const fm = splitFrontmatter(content)
  if (fm?.data) {
    for (const key of ['tags', 'tag', 'Tags']) {
      for (const raw of frontmatterList(fm.data[key])) {
        const t = normalizeTag(raw)
        if (t) tags.add(t)
      }
    }
  }
  const body = stripCode(fm ? fm.body : content)
  for (const m of body.matchAll(INLINE_TAG_RE)) {
    const t = normalizeTag(m[2])
    if (t) tags.add(t)
  }
  return [...tags].sort()
}

// Innerhalb eines Links sind keine eckigen Klammern erlaubt (verhindert quadratische Laufzeit bei „[[[[…“)
const WIKILINK_RE = /(!?)\[\[([^[\]\n]{1,1000})\]\]/g

type WikiLink = { embed: boolean; target: string; heading: string | null; alias: string | null }

export function parseWikiTarget(inner: string): Omit<WikiLink, 'embed'> {
  let target = inner
  let alias: string | null = null
  const pipe = target.indexOf('|')
  if (pipe >= 0) {
    alias = target.slice(pipe + 1).trim() || null
    target = target.slice(0, pipe)
  }
  let heading: string | null = null
  const hash = target.indexOf('#')
  if (hash >= 0) {
    heading = target.slice(hash + 1).trim() || null
    target = target.slice(0, hash)
  }
  return { target: target.trim(), heading, alias }
}

export function findWikiLinks(content: string): WikiLink[] {
  const links: WikiLink[] = []
  for (const m of stripCode(content).matchAll(WIKILINK_RE)) {
    links.push({ embed: m[1] === '!', ...parseWikiTarget(m[2]) })
  }
  return links
}

/** Hat das Linkziel eine Dateiendung, die keine Notiz ist (z. B. Bild)? */
export function isFileTarget(target: string): boolean {
  const m = /\.([a-z0-9]{1,10})$/i.exec(target)
  return !!m && m[1].toLowerCase() !== 'md'
}

/** Normalisiertes Linkziel (Basisname ohne .md, klein geschrieben) – zum Auflösen von Backlinks. */
export function linkKey(target: string): string {
  const base = target.split('/').pop() ?? target
  return base.replace(/\.md$/i, '').trim().toLowerCase()
}

/** Ordnerteil eines Linkziels, klein geschrieben: „Uni/Analysis/Übung 1“ → ['uni', 'analysis'] */
export function linkFolders(target: string): string[] {
  return target
    .split('/')
    .slice(0, -1)
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
}

/** Link auf eine Notiz: `key` wie linkKey, `path` der Ordnerteil wie linkFolders („uni/analysis“, ohne Ordner '') */
export type NoteLink = { key: string; path: string }

/** Alle verlinkten Notizen (ohne Dateien/Anhänge). */
export function extractLinks(content: string): NoteLink[] {
  const links = new Map<string, NoteLink>()
  for (const link of findWikiLinks(content)) {
    if (!link.target || isFileTarget(link.target)) continue
    const key = linkKey(link.target)
    const path = linkFolders(link.target).join('/')
    links.set(`${path}/${key}`, { key, path })
  }
  return [...links.values()].sort((a, b) => (a.key === b.key ? (a.path < b.path ? -1 : 1) : a.key < b.key ? -1 : 1))
}

const LINE_PREFIX_RE = /^\s{0,3}(#{1,6}\s+|>\s*(\[![^\]]*\][+-]?\s*)?|[-*+]\s+(\[.\]\s+)?|\d+[.)]\s+)/gm

/** Kurzer Textauszug für Listen (ohne Frontmatter und Markdown-Zeichen). */
export function makeExcerpt(content: string, max = 160): string {
  const fm = splitFrontmatter(content)
  // Für einen Auszug genügt der Anfang – begrenzt zugleich die Rechenzeit
  const text = plainInline(stripCode((fm ? fm.body : content).slice(0, 4000)).replace(LINE_PREFIX_RE, ''))
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text
}
