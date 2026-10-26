// Tags umbenennen: #tag im Text und in den Properties ersetzen – samt Unter-Tags, die Schreibweise des Rests bleibt
// (`#Mathe/Analysis` → `#Studium/Analysis`). Code, Kommentare und HTML-Attribute (z. B. `color: #ff0000`) bleiben
// unberührt – dieselben Regeln, nach denen extractTags die Tags beim Speichern liest.
import { mapCanvasNodes } from '@/features/canvas/canvas'
import { INLINE_TAG_RE, splitFrontmatter, stripCode } from '@/shared/markdown/meta'
import type { NoteFormat } from './types'

/** Neuer Name, falls `tag` der umbenannte Tag ist oder darunter liegt – sonst null. `from` ist normalisiert. */
function renamed(tag: string, from: string, to: string): string | null {
  const lower = tag.toLowerCase()
  if (lower === from) return to
  if (lower.startsWith(from + '/')) return to + tag.slice(from.length)
  return null
}

/** #tags außerhalb von Code und Kommentaren – `re` findet „Leerraum davor“ und den Namen */
function renameInline(text: string, from: string, to: string, re: RegExp): string {
  // Gleich lang wie der Text, nur Code und Kommentare durch Leerzeichen ersetzt
  const masked = stripCode(text)
  let out = ''
  let last = 0
  for (const m of masked.matchAll(re)) {
    const start = m.index + m[1].length + 1
    const next = renamed(m[2], from, to)
    if (next === null) continue
    out += text.slice(last, start) + next
    last = start + m[2].length
  }
  return last === 0 ? text : out + text.slice(last)
}

const TAG_KEY_RE = /^(tags|tag|Tags)[ \t]*:(.*)$/
// Ein Eintrag in einer Liste oder einem Text: nach Anfang, Leerraum, „[“, „,“ oder Anführungszeichen, wahlweise mit „#“
const TAG_TOKEN_RE = /(^|[\s[,'"])(#?)([\p{L}\p{N}_\-/]+)(?=$|[\s,\]'"])/gu

/** Tags in einem YAML-Wert – ein Kommentar (Leerraum, dann „#“) bleibt, wie er ist */
function renameTokens(value: string, from: string, to: string): string {
  const cut = value.search(/(^|\s)#/)
  const head = cut < 0 ? value : value.slice(0, cut)
  const renamedHead = head.replace(TAG_TOKEN_RE, (m, before: string, hash: string, tag: string) => {
    const next = renamed(tag, from, to)
    return next === null ? m : before + hash + next
  })
  return renamedHead + (cut < 0 ? '' : value.slice(cut))
}

/** Tags im Frontmatter (tags, tag, Tags – als Liste oder Text). Nur diese Zeilen ändern sich. */
function renameFrontmatter(raw: string, from: string, to: string): string {
  const lines = raw.split('\n')
  let inTags = false
  for (let i = 0; i < lines.length; i++) {
    const key = TAG_KEY_RE.exec(lines[i])
    if (key) {
      inTags = true
      lines[i] = lines[i].slice(0, lines[i].length - key[2].length) + renameTokens(key[2], from, to)
    } else if (inTags && /^([ \t]|-)/.test(lines[i])) {
      // Eingerückte Folgezeilen und Listeneinträge gehören noch zum Wert
      lines[i] = renameTokens(lines[i], from, to)
    } else inTags = false
  }
  return lines.join('\n')
}

function renameMarkdown(content: string, from: string, to: string): string {
  const fm = splitFrontmatter(content)
  if (!fm) return renameInline(content, from, to, INLINE_TAG_RE)
  const body = renameInline(fm.body, from, to, INLINE_TAG_RE)
  if (!fm.raw) return content.slice(0, content.length - fm.body.length) + body
  const start = content.indexOf(fm.raw)
  return (
    content.slice(0, start) +
    renameFrontmatter(fm.raw, from, to) +
    content.slice(start + fm.raw.length, content.length - fm.body.length) +
    body
  )
}

const HTML_TAG_RE = /(^|\s|&nbsp;)#([\p{L}\p{N}_\-/]+)/gu
const BLOCK_ELEMENT = /^(p|div|li|ul|ol|h[1-6]|br|hr|tr|td|th|table|blockquote|pre)$/

/** Formatierter Text: nur in Textteilen zwischen den HTML-Tags, nicht in Code */
function renameHtml(html: string, from: string, to: string): string {
  let out = ''
  // Zwischen zwei Blöcken steht für die Tags ein Zeilenumbruch (wie in htmlToText)
  let spaceBefore = true
  let code = 0
  for (const part of html.split(/(<[^>]*>)/)) {
    if (!part) continue
    if (part.startsWith('<')) {
      const m = /^<\s*(\/?)\s*([a-z][a-z0-9]*)/i.exec(part)
      const name = m?.[2].toLowerCase() ?? ''
      if (name === 'code' || name === 'pre') code = Math.max(0, code + (m?.[1] ? -1 : 1))
      if (BLOCK_ELEMENT.test(name)) spaceBefore = true
      out += part
      continue
    }
    if (code > 0) out += part
    else out += renameInline((spaceBefore ? ' ' : 'x') + part, from, to, HTML_TAG_RE).slice(1)
    spaceBefore = /\s$/.test(part)
  }
  return out
}

/** Inhalt einer Notiz mit umbenanntem Tag – `from` und `to` sind normalisiert (normalizeTag), `to` wie eingegeben */
export function renameTagIn(format: NoteFormat, content: string, from: string, to: string): string {
  if (format === 'richtext') return renameHtml(content, from, to)
  if (format === 'canvas') {
    return mapCanvasNodes(content, (n) => {
      if (n.type !== 'text') return n
      const text = renameMarkdown(n.text, from, to)
      return text === n.text ? n : { ...n, text }
    })
  }
  return renameMarkdown(content, from, to)
}
