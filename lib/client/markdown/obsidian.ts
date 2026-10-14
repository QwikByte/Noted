// markdown-it-Plugins für Obsidian-Syntax: Wikilinks, Einbettungen, Tags, ==Markierungen==,
// Callouts, Aufgabenlisten, Kommentare (%% %%) und Überschriften-Anker.
import type { MarkdownIt, StateCore, StateInline, Token } from 'markdown-it'
import { isFileTarget, parseWikiTarget } from '@/lib/shared/markdown-meta'

export type ResolvedNote = { id: string; title: string }

export type RenderEnv = {
  /** Wikilink-Ziel zu einer Notiz auflösen */
  resolveNote?: (target: string) => ResolvedNote | null
  /** URL für einen Anhang (![[bild.png]]) */
  fileUrl?: (name: string) => string
  /** Zeilenversatz (z. B. durch entferntes Frontmatter) für Checkbox-Zeilennummern */
  lineOffset?: number
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i
const AUDIO_EXT = /\.(mp3|m4a|wav|ogg|flac)$/i
const VIDEO_EXT = /\.(mp4|webm|mov|mkv)$/i
const PDF_EXT = /\.pdf$/i
const PDF_PAGE_RE = /^page=(\d{1,5})\b/i
const ATTACHMENT_EXT =
  /\.(pdf|png|jpe?g|gif|webp|avif|bmp|svg|heic|heif|mp3|m4a|wav|ogg|flac|mp4|webm|mov|mkv|txt|csv|json|zip|docx?|xlsx?|pptx?|odt|ods|odp|epub)$/i

export function defaultFileUrl(name: string) {
  return '/api/files/' + name.split('/').map(encodeURIComponent).join('/')
}

// ---------------------------------------------------------------------------
// Wikilinks und Einbettungen: [[Ziel]], [[Ziel|Alias]], [[Ziel#Abschnitt]], ![[bild.png|300]]
// ---------------------------------------------------------------------------

function wikilinkRule(state: StateInline, silent: boolean): boolean {
  const src = state.src
  let pos = state.pos
  const embed = src.charCodeAt(pos) === 0x21 /* ! */
  if (embed) pos++
  if (src.charCodeAt(pos) !== 0x5b || src.charCodeAt(pos + 1) !== 0x5b) return false
  // Suche begrenzen (sonst quadratische Laufzeit bei sehr vielen „[[“)
  const window = src.slice(pos + 2, Math.min(state.posMax, pos + 2 + 1000))
  const rel = window.indexOf(']]')
  if (rel < 0) return false
  const end = pos + 2 + rel
  const inner = window.slice(0, rel)
  if (!inner.trim() || inner.includes('\n') || inner.includes('[')) return false
  if (!silent) {
    const token = state.push('wikilink', '', 0)
    token.meta = { embed, ...parseWikiTarget(inner) }
    token.content = inner
  }
  state.pos = end + 2
  return true
}

function renderWikilink(tokens: Token[], idx: number, _opts: unknown, env: RenderEnv): string {
  const { embed, target, heading, alias } = tokens[idx].meta as {
    embed: boolean
    target: string
    heading: string | null
    alias: string | null
  }
  const fileUrl = env.fileUrl ?? defaultFileUrl
  // Links ([[…]]) auf Dateien nur bei typischen Anhang-Endungen – sonst sind es Notizen wie [[Kapitel 3.1]]
  const linkedNote = !embed && target ? (env.resolveNote?.(target) ?? null) : null
  const isFile = embed ? isFileTarget(target) : !linkedNote && ATTACHMENT_EXT.test(target)

  if (target && isFile) {
    const url = escapeHtml(fileUrl(target))
    const name = escapeHtml(target.split('/').pop() ?? target)
    // PDFs öffnen im eingebauten Viewer – auch direkt auf einer Seite: [[Skript.pdf#page=12]]
    const isPdf = PDF_EXT.test(target)
    const page = isPdf && heading ? (PDF_PAGE_RE.exec(heading)?.[1] ?? null) : null
    const pdfAttrs = isPdf ? ` data-pdf="${escapeHtml(target)}"${page ? ` data-page="${page}"` : ''}` : ''
    if (!embed) {
      const label = alias ? escapeHtml(alias) : page ? `${name}, S. ${page}` : name
      return `<a class="file-link${isPdf ? ' file-link-pdf' : ''}" href="${url}" target="_blank" rel="noopener"${pdfAttrs}>${label}</a>`
    }
    if (IMAGE_EXT.test(target)) {
      let size = ''
      const m = alias ? /^(\d+)(?:x(\d+))?$/.exec(alias) : null
      if (m) size = ` width="${m[1]}"${m[2] ? ` height="${m[2]}"` : ''}`
      const alt = alias && !m ? escapeHtml(alias) : name
      return `<img src="${url}" alt="${alt}" loading="lazy" class="embed-image"${size}>`
    }
    if (AUDIO_EXT.test(target)) return `<audio controls preload="metadata" src="${url}" class="embed-audio"></audio>`
    if (VIDEO_EXT.test(target)) return `<video controls preload="metadata" src="${url}" class="embed-video"></video>`
    const kind = isPdf ? 'pdf' : 'file'
    const label = page ? `${name} · Seite ${page}` : name
    return `<a class="embed-file embed-${kind}" href="${url}" target="_blank" rel="noopener"${pdfAttrs}><span class="embed-file-icon"></span><span>${label}</span></a>`
  }

  const note = linkedNote ?? (target ? (env.resolveNote?.(target) ?? null) : null)
  const label = escapeHtml(alias ?? (target ? (heading ? `${target} › ${heading}` : target) : (heading ?? '')))
  const anchor = heading ? `#${encodeURIComponent(slugify(heading))}` : ''
  if (!target && heading) {
    return `<a class="wikilink" href="${anchor}">${label}</a>`
  }
  const attrs = `data-target="${escapeHtml(target)}"${heading ? ` data-heading="${escapeHtml(heading)}"` : ''}`
  if (embed) {
    return note
      ? `<a class="embed-note" href="/?n=${note.id}${anchor}" data-note-id="${note.id}" ${attrs}><span class="embed-note-label">Eingebettet</span> ${label}</a>`
      : `<span class="embed-note unresolved" ${attrs}><span class="embed-note-label">Eingebettet</span> ${label}</span>`
  }
  return note
    ? `<a class="wikilink" href="/?n=${note.id}${anchor}" data-note-id="${note.id}" ${attrs}>${label}</a>`
    : `<a class="wikilink unresolved" href="#" ${attrs} title="Notiz existiert noch nicht – klicken zum Anlegen">${label}</a>`
}

// ---------------------------------------------------------------------------
// ==Markierung==
// ---------------------------------------------------------------------------

function markRule(state: StateInline, silent: boolean): boolean {
  const start = state.pos
  const src = state.src
  if (src.charCodeAt(start) !== 0x3d || src.charCodeAt(start + 1) !== 0x3d) return false
  if (src.charCodeAt(start + 2) === 0x3d) return false
  const end = src.indexOf('==', start + 2)
  if (end < 0 || end === start + 2 || end > state.posMax) return false
  const inner = src.slice(start + 2, end)
  if (/^\s|\s$/.test(inner)) return false
  if (!silent) {
    state.push('mark_open', 'mark', 1)
    const oldMax = state.posMax
    state.pos = start + 2
    state.posMax = end
    state.md.inline.tokenize(state)
    state.posMax = oldMax
    state.push('mark_close', 'mark', -1)
  }
  state.pos = end + 2
  return true
}

// ---------------------------------------------------------------------------
// #Tags
// ---------------------------------------------------------------------------

const TAG_RE = /^#([\p{L}\p{N}_\-/]+)/u

function tagRule(state: StateInline, silent: boolean): boolean {
  const pos = state.pos
  if (state.src.charCodeAt(pos) !== 0x23 /* # */) return false
  const prev = pos > 0 ? state.src[pos - 1] : ''
  if (prev && !/\s/.test(prev)) return false
  const m = TAG_RE.exec(state.src.slice(pos, state.posMax))
  if (!m) return false
  const tag = m[1].replace(/\/+$/, '')
  if (!tag || /^[\d/]+$/.test(tag)) return false
  if (!silent) {
    const token = state.push('obsidian_tag', '', 0)
    token.content = tag
  }
  state.pos = pos + 1 + tag.length
  return true
}

function renderTag(tokens: Token[], idx: number): string {
  const tag = tokens[idx].content
  const norm = tag.toLowerCase()
  return `<a class="tag" href="/?t=${encodeURIComponent(norm)}" data-tag="${escapeHtml(norm)}">#${escapeHtml(tag)}</a>`
}

// ---------------------------------------------------------------------------
// Callouts: > [!note] Titel   /   > [!tip]- Einklappbar
// ---------------------------------------------------------------------------

const CALLOUT_RE = /^\[!([\w-]+)\]([+-]?)[ \t]*(.*)$/

const CALLOUT_ALIASES: Record<string, string> = {
  note: 'note',
  abstract: 'abstract',
  summary: 'abstract',
  tldr: 'abstract',
  info: 'info',
  todo: 'todo',
  tip: 'tip',
  hint: 'tip',
  important: 'tip',
  success: 'success',
  check: 'success',
  done: 'success',
  question: 'question',
  help: 'question',
  faq: 'question',
  warning: 'warning',
  caution: 'warning',
  attention: 'warning',
  failure: 'failure',
  fail: 'failure',
  missing: 'failure',
  danger: 'danger',
  error: 'danger',
  bug: 'bug',
  example: 'example',
  quote: 'quote',
  cite: 'quote',
}

const ICONS: Record<string, string> = {
  note: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  abstract:
    '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  todo: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  tip: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  success: '<path d="M20 6 9 17l-5-5"/>',
  question: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  warning:
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  failure: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  danger:
    '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  bug: '<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6 13H2"/><path d="M22 13h-4"/>',
  example: '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
  quote:
    '<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>',
}

const DEFAULT_TITLES: Record<string, string> = {
  note: 'Notiz',
  abstract: 'Zusammenfassung',
  info: 'Info',
  todo: 'Aufgabe',
  tip: 'Tipp',
  success: 'Erledigt',
  question: 'Frage',
  warning: 'Achtung',
  failure: 'Fehlgeschlagen',
  danger: 'Gefahr',
  bug: 'Fehler',
  example: 'Beispiel',
  quote: 'Zitat',
}

function calloutIcon(kind: string) {
  return `<svg class="callout-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[kind] ?? ICONS.note}</svg>`
}

function calloutsRule(state: StateCore) {
  const tokens = state.tokens
  for (let i = 0; i < tokens.length; i++) {
    const open = tokens[i]
    if (open.type !== 'blockquote_open') continue
    const pOpen = tokens[i + 1]
    const inline = tokens[i + 2]
    if (pOpen?.type !== 'paragraph_open' || inline?.type !== 'inline') continue
    const firstLineEnd = inline.content.indexOf('\n')
    const firstLine = firstLineEnd >= 0 ? inline.content.slice(0, firstLineEnd) : inline.content
    const m = CALLOUT_RE.exec(firstLine.trim())
    if (!m) continue

    const rawType = m[1].toLowerCase()
    const kind = CALLOUT_ALIASES[rawType] ?? 'note'
    const fold = m[2]
    const title = m[3].trim() || DEFAULT_TITLES[kind] || rawType.charAt(0).toUpperCase() + rawType.slice(1)

    // Passendes blockquote_close finden
    let depth = 0
    let closeIdx = -1
    for (let j = i; j < tokens.length; j++) {
      if (tokens[j].type === 'blockquote_open') depth++
      else if (tokens[j].type === 'blockquote_close' && --depth === 0) {
        closeIdx = j
        break
      }
    }
    if (closeIdx < 0) continue

    const tag = fold ? 'details' : 'div'
    open.tag = tag
    open.attrSet('class', `callout callout-${kind}`)
    open.attrSet('data-callout', rawType)
    if (fold === '+') open.attrSet('open', '')
    tokens[closeIdx].tag = tag

    const titleToken = new state.Token('html_block', '', 0)
    const summaryTag = fold ? 'summary' : 'div'
    titleToken.content = `<${summaryTag} class="callout-title">${calloutIcon(kind)}<span class="callout-title-text">${escapeHtml(title)}</span></${summaryTag}><div class="callout-content">`
    const closeContent = new state.Token('html_block', '', 0)
    closeContent.content = '</div>'

    const rest = firstLineEnd >= 0 ? inline.content.slice(firstLineEnd + 1) : ''
    const insertions: Token[] = [titleToken]
    if (rest.trim()) {
      inline.content = rest
      if (inline.map) inline.map = [inline.map[0] + 1, inline.map[1]]
      tokens.splice(closeIdx, 0, closeContent)
      tokens.splice(i + 1, 0, ...insertions)
    } else {
      // Erster Absatz bestand nur aus dem Titel: Absatz entfernen
      tokens.splice(closeIdx, 0, closeContent)
      tokens.splice(i + 1, 3, ...insertions)
    }
  }
}

// ---------------------------------------------------------------------------
// Aufgabenlisten: - [ ] offen, - [x] erledigt (anklickbar in der Vorschau)
// ---------------------------------------------------------------------------

const TASK_RE = /^\[([ xX/\-><!?*])\](?:[ \t]|$)/

function tasksRule(state: StateCore) {
  const tokens = state.tokens
  const offset = (state.env as RenderEnv)?.lineOffset ?? 0
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i]
    if (inline.type !== 'inline' || tokens[i - 1].type !== 'paragraph_open' || tokens[i - 2].type !== 'list_item_open') {
      continue
    }
    const m = TASK_RE.exec(inline.content)
    if (!m) continue
    const item = tokens[i - 2]
    const status = m[1]
    const checked = status !== ' '
    const line = (item.map?.[0] ?? 0) + offset
    item.attrJoin('class', 'task-list-item')
    if (checked) item.attrJoin('class', 'is-checked')
    item.attrSet('data-task', status)

    const first = inline.children?.[0]
    if (first?.type === 'text') first.content = first.content.slice(m[0].length)
    const checkbox = new state.Token('html_inline', '', 0)
    checkbox.content = `<input type="checkbox" class="task-checkbox" data-line="${line}"${checked ? ' checked' : ''} aria-label="Aufgabe erledigt">`
    inline.children?.unshift(checkbox)

    // Liste markieren
    for (let j = i - 3; j >= 0; j--) {
      const t = tokens[j]
      if ((t.type === 'bullet_list_open' || t.type === 'ordered_list_open') && t.level === item.level - 1) {
        if (!t.attrGet('class')?.includes('contains-task-list')) t.attrJoin('class', 'contains-task-list')
        break
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Überschriften-Anker (für [[Notiz#Abschnitt]])
// ---------------------------------------------------------------------------

function headingIdsRule(state: StateCore) {
  const used = new Map<string, number>()
  const tokens = state.tokens
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'heading_open') continue
    const inline = tokens[i + 1]
    const base = slugify(inline?.content ?? '') || 'abschnitt'
    const n = used.get(base) ?? 0
    used.set(base, n + 1)
    tokens[i].attrSet('id', n ? `${base}-${n}` : base)
  }
}

// ---------------------------------------------------------------------------

export function obsidianPlugin(md: MarkdownIt) {
  md.inline.ruler.before('link', 'wikilink', wikilinkRule)
  md.inline.ruler.before('emphasis', 'mark', markRule)
  md.inline.ruler.push('obsidian_tag', tagRule)
  md.renderer.rules.wikilink = renderWikilink as never
  md.renderer.rules.obsidian_tag = renderTag
  md.core.ruler.before('inline', 'callouts', calloutsRule)
  md.core.ruler.after('inline', 'tasks', tasksRule)
  md.core.ruler.push('heading_ids', headingIdsRule)

  // Relative Bild-Links (![](bild.png)) auf Anhänge umleiten
  const defaultImage = md.renderer.rules.image!
  md.renderer.rules.image = (tokens, idx, options, env: RenderEnv, self) => {
    const token = tokens[idx]
    const src = token.attrGet('src') ?? ''
    if (src && !/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(src)) {
      let name = src
      try {
        name = decodeURIComponent(src)
      } catch {
        /* unverändert lassen */
      }
      token.attrSet('src', (env.fileUrl ?? defaultFileUrl)(name))
    }
    token.attrSet('loading', 'lazy')
    return defaultImage(tokens, idx, options, env, self)
  }
}

/** Entfernt Obsidian-Kommentare (%% … %%) außerhalb von Code-Blöcken. */
export function stripComments(markdown: string): string {
  if (!markdown.includes('%%')) return markdown
  const parts = markdown.split(/(^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)[ \t]*$)/m)
  return parts
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/%%[\s\S]*?%%/g, (m) => '\n'.repeat(m.split('\n').length - 1))))
    .join('')
}
