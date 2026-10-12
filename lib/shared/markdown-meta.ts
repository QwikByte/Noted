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

/** Code-Blöcke, Inline-Code und Kommentare entfernen (Zeilen bleiben erhalten). */
export function stripCode(text: string): string {
  return text
    .replace(/^(\s*)(```|~~~)[^\n]*\n[\s\S]*?(?:^\s*\2[^\n]*$|(?![\s\S]))/gm, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/%%[\s\S]*?%%/g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(`+)[^`\n][\s\S]*?\1/g, (code) => code.replace(/[^\n]/g, ' '))
}

const INLINE_TAG_RE = /(^|\s)#([\p{L}\p{N}_\-/]+)/gu

export function normalizeTag(tag: string): string | null {
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

const WIKILINK_RE = /(!?)\[\[([^\]\n]+?)\]\]/g

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
  const text = stripCode(fm ? fm.body : content)
    .replace(/!\[\[[^\]]*\]\]/g, ' ')
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}\s+|>\s*(\[![^\]]*\][+-]?\s*)?|[-*+]\s+(\[.\]\s+)?|\d+[.)]\s+)/gm, '')
    .replace(/[*_~=`$]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text
}
