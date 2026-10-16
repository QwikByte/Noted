// Auswertung von Obsidian-Markdown: Frontmatter (Properties), Tags und Wikilinks.
import { parse as parseYaml } from 'yaml'

const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/

export type Frontmatter = { raw: string; data: Record<string, unknown> | null; body: string; lines: number }

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
 * Code-Blöcke, Inline-Code und Kommentare durch Leerzeichen ersetzen (Zeilen bleiben erhalten).
 * Bewusst zeilenweise statt mit einer großen Regex – sonst droht quadratische Laufzeit.
 */
export function stripCode(text: string): string {
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
  return lines
    .join('\n')
    .replace(/%%[\s\S]*?%%/g, blank)
    .replace(/(`+)[^`\n][\s\S]*?\1/g, blank)
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

export type WikiLink = { embed: boolean; target: string; heading: string | null; alias: string | null }

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

/** Alle verlinkten Notizen (ohne Dateien/Anhänge). */
export function extractLinks(content: string): string[] {
  const keys = new Set<string>()
  for (const link of findWikiLinks(content)) {
    if (!link.target || isFileTarget(link.target)) continue
    keys.add(linkKey(link.target))
  }
  return [...keys].sort()
}

/** Kurzer Textauszug für Listen (ohne Frontmatter und Markdown-Zeichen). */
export function makeExcerpt(content: string, max = 160): string {
  const fm = splitFrontmatter(content)
  // Für einen Auszug genügt der Anfang – begrenzt zugleich die Rechenzeit
  const text = stripCode((fm ? fm.body : content).slice(0, 4000))
    .replace(/!\[\[[^[\]\n]*\]\]/g, ' ')
    .replace(/\[\[([^[\]|\n]*\|)?([^[\]\n]*)\]\]/g, '$2')
    .replace(/!?\[([^[\]\n]*)\]\([^()\n]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}\s+|>\s*(\[![^\]]*\][+-]?\s*)?|[-*+]\s+(\[.\]\s+)?|\d+[.)]\s+)/gm, '')
    .replace(/[*_~=`$]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text
}
