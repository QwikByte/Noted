// Mindmaps als Markdown-Gliederung im Format des Obsidian-Plugins „Enhancing Mindmap“: Properties mit
// `mindmap-plugin: basic`, die Wurzel als `# …`, die erste Ebene als `## …`, alles darunter als Liste.
// Obsidian zeigt so eine Datei ohne Plugin als gewöhnliche Gliederung an.
import { splitFrontmatter } from '@/shared/markdown/meta'

export type MindNode = { id: string; text: string; children: MindNode[] }

const PLUGIN_PROPERTY = 'mindmap-plugin'
const PLUGIN_LINE = `${PLUGIN_PROPERTY}: basic`
const PLUGIN_LINE_RE = new RegExp(`^${PLUGIN_PROPERTY}[ \\t]*:.*$`, 'm')

let nextId = 0
/** IDs gelten nur im Browser während der Bearbeitung – gespeichert wird reiner Text */
export const newNodeId = () => `m${(++nextId).toString(36)}`

const node = (text: string): MindNode => ({ id: newNodeId(), text, children: [] })

const HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/
const LIST_RE = /^([ \t]*)(?:[-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/
const FENCE_RE = /^[ \t]*(`{3,}|~{3,})/
const RULE_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/

/** Einrückung in Spalten (Tab = bis zur nächsten Viererstelle) */
function indentWidth(s: string): number {
  let w = 0
  for (const c of s) w += c === '\t' ? 4 - (w % 4) : 1
  return w
}

/** Text eines Knotens: einzeilig, ohne Leerzeichen am Rand */
export const cleanNodeText = (text: string) => text.replace(/\s*\r?\n\s*/g, ' ').trim()

/**
 * Markdown → Baum. Überschriften bilden die Ebenen, Listen darunter die Unterpunkte, übrige Absätze werden zu
 * eigenen Knoten. Code-Blöcke entfallen. Gibt es nicht genau eine oberste Überschrift, ist der Titel die Wurzel.
 */
export function parseMindmap(markdown: string, fallbackTitle: string): MindNode {
  const fm = splitFrontmatter(markdown)
  const body = fm ? fm.body : markdown
  const top: MindNode[] = []
  const headings: { level: number; node: MindNode }[] = []
  let items: { indent: number; node: MindNode }[] = []
  let paragraph: MindNode | null = null
  let fence: string | null = null
  const container = () => (headings.length ? headings[headings.length - 1].node.children : top)

  for (const line of body.split(/\r?\n/)) {
    const f = FENCE_RE.exec(line)
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null
      continue
    }
    if (f) {
      fence = f[1]
      paragraph = null
      continue
    }
    if (!line.trim() || RULE_RE.test(line)) {
      paragraph = null
      continue
    }
    const h = HEADING_RE.exec(line)
    if (h) {
      const level = h[1].length
      while (headings.length && headings[headings.length - 1].level >= level) headings.pop()
      const n = node(cleanNodeText(h[2] ?? ''))
      container().push(n)
      headings.push({ level, node: n })
      items = []
      paragraph = null
      continue
    }
    const l = LIST_RE.exec(line)
    if (l) {
      const indent = indentWidth(l[1])
      while (items.length && items[items.length - 1].indent >= indent) items.pop()
      const n = node(cleanNodeText(l[2] ?? ''))
      ;(items.length ? items[items.length - 1].node.children : container()).push(n)
      items.push({ indent, node: n })
      paragraph = null
      continue
    }
    const text = cleanNodeText(line)
    const last = items[items.length - 1]
    // Eingerückte Folgezeile gehört zum Listenpunkt darüber, Folgezeilen eines Absatzes zum Absatz
    if (last && indentWidth(/^[ \t]*/.exec(line)![0]) > last.indent) {
      last.node.text = cleanNodeText(`${last.node.text} ${text}`)
      continue
    }
    if (paragraph) {
      paragraph.text = cleanNodeText(`${paragraph.text} ${text}`)
      continue
    }
    items = []
    paragraph = node(text)
    container().push(paragraph)
  }

  if (top.length === 1) return top[0]
  return { id: newNodeId(), text: cleanNodeText(fallbackTitle), children: top }
}

/** Properties (YAML ohne die Striche) – mit dem Kennzeichen für das Mindmap-Plugin */
function mindmapProperties(raw: string | null): string {
  if (raw === null || !raw.trim()) return PLUGIN_LINE
  return PLUGIN_LINE_RE.test(raw) ? raw.replace(/\s+$/, '') : `${PLUGIN_LINE}\n${raw.replace(/\s+$/, '')}`
}

/** Baum → Markdown. Vorhandene Properties bleiben erhalten. */
export function serializeMindmap(root: MindNode, properties: string | null): string {
  const out: string[] = [`---\n${mindmapProperties(properties)}\n---`, '', `# ${cleanNodeText(root.text)}`.trimEnd()]
  const list = (n: MindNode, depth: number) => {
    out.push(`${'\t'.repeat(depth)}- ${cleanNodeText(n.text)}`.trimEnd())
    for (const c of n.children) list(c, depth + 1)
  }
  for (const child of root.children) {
    out.push('', `## ${cleanNodeText(child.text)}`.trimEnd())
    for (const c of child.children) list(c, 0)
  }
  return out.join('\n') + '\n'
}

/** Properties einer Mindmap-Notiz (für serializeMindmap) */
export function mindmapPropertiesOf(markdown: string): string | null {
  return splitFrontmatter(markdown)?.raw ?? null
}

/** Inhalt einer neuen Mindmap */
export function newMindmap(title: string): string {
  return serializeMindmap({ id: newNodeId(), text: title, children: [] }, null)
}

/**
 * Ist das eine Mindmap des Obsidian-Plugins? (Import) Nur „basic“: Markmind nutzt denselben Schlüssel, speichert im
 * Modus „rich“ aber keine Gliederung – solche Dateien bleiben Markdown.
 */
export function isMindmapMarkdown(markdown: string): boolean {
  return splitFrontmatter(markdown)?.data?.[PLUGIN_PROPERTY] === 'basic'
}

/** Mindmap → gewöhnliches Markdown: nur das Kennzeichen für das Plugin entfällt */
export function mindmapToMarkdown(markdown: string): string {
  const fm = splitFrontmatter(markdown)
  if (!fm || !PLUGIN_LINE_RE.test(fm.raw)) return markdown
  const rest = fm.raw
    .split(/\r?\n/)
    .filter((l) => !PLUGIN_LINE_RE.test(l))
    .join('\n')
  const body = fm.body.replace(/^(?:[ \t]*\r?\n)+/, '')
  return rest.trim() ? `---\n${rest.replace(/\s+$/, '')}\n---\n\n${body}` : body
}

// ---------------------------------------------------------------------------
// Bearbeiten (unveränderlich: jede Änderung liefert einen neuen Baum)
// ---------------------------------------------------------------------------

export function findNode(root: MindNode, id: string): MindNode | null {
  if (root.id === id) return root
  for (const c of root.children) {
    const hit = findNode(c, id)
    if (hit) return hit
  }
  return null
}

/** Elternknoten und Position eines Knotens */
export function findParent(root: MindNode, id: string): { parent: MindNode; index: number } | null {
  for (let i = 0; i < root.children.length; i++) {
    if (root.children[i].id === id) return { parent: root, index: i }
    const hit = findParent(root.children[i], id)
    if (hit) return hit
  }
  return null
}

function mapNode(root: MindNode, id: string, fn: (n: MindNode) => MindNode): MindNode {
  if (root.id === id) return fn(root)
  let changed = false
  const children = root.children.map((c) => {
    const next = mapNode(c, id, fn)
    if (next !== c) changed = true
    return next
  })
  return changed ? { ...root, children } : root
}

export function setNodeText(root: MindNode, id: string, text: string): MindNode {
  return mapNode(root, id, (n) => ({ ...n, text: cleanNodeText(text) }))
}

export function addChild(root: MindNode, parentId: string, child: MindNode, index?: number): MindNode {
  return mapNode(root, parentId, (n) => {
    const children = [...n.children]
    children.splice(index ?? children.length, 0, child)
    return { ...n, children }
  })
}

/** Neuer Knoten direkt nach (bzw. vor) einem anderen; an der Wurzel als Unterpunkt */
export function addSibling(root: MindNode, id: string, sibling: MindNode, before = false): MindNode {
  const at = findParent(root, id)
  if (!at) return addChild(root, root.id, sibling)
  return addChild(root, at.parent.id, sibling, at.index + (before ? 0 : 1))
}

export function removeNode(root: MindNode, id: string): MindNode {
  const at = findParent(root, id)
  if (!at) return root
  return mapNode(root, at.parent.id, (n) => ({ ...n, children: n.children.filter((c) => c.id !== id) }))
}

/** Knoten (samt Unterpunkten) unter einen anderen hängen – nicht in sich selbst */
export function moveNode(root: MindNode, id: string, parentId: string, index?: number): MindNode {
  const moving = findNode(root, id)
  if (!moving || id === root.id || findNode(moving, parentId)) return root
  return addChild(removeNode(root, id), parentId, moving, index)
}

/** Unter den Geschwistern nach oben (-1) oder unten (+1) schieben */
export function shiftNode(root: MindNode, id: string, delta: -1 | 1): MindNode {
  const at = findParent(root, id)
  if (!at) return root
  const target = at.index + delta
  if (target < 0 || target >= at.parent.children.length) return root
  return mapNode(root, at.parent.id, (n) => {
    const children = [...n.children]
    ;[children[at.index], children[target]] = [children[target], children[at.index]]
    return { ...n, children }
  })
}

// ---------------------------------------------------------------------------
// Anordnung: Wurzel in der Mitte, erste Ebene abwechselnd rechts und links verteilt
// ---------------------------------------------------------------------------

export type MindSide = 'root' | 'right' | 'left'
export type Size = { width: number; height: number }
export type PlacedNode = {
  node: MindNode
  parentId: string | null
  x: number
  y: number
  width: number
  height: number
  side: MindSide
  depth: number
  /** Hauptast (Index unter der Wurzel) – bestimmt die Farbe */
  branch: number
}

const BRANCH_SWATCHES = [6, 4, 2, 5, 1, 3]
/** Farbe eines Hauptasts: „1“ bis „6“ wie die Canvas-Farben (siehe --swatch-* in globals.css) */
export const branchSwatch = (branch: number) => BRANCH_SWATCHES[branch % BRANCH_SWATCHES.length]

const H_GAP = [64, 44]
const V_GAP = [18, 10]

/** Positionen (linke obere Ecke) aller sichtbaren Knoten; eingeklappte Äste zeigen ihre Unterpunkte nicht */
export function layoutMindmap(root: MindNode, sizeOf: (n: MindNode, depth: number) => Size, collapsed: ReadonlySet<string>): PlacedNode[] {
  const sizes = new Map<string, Size>()
  const heights = new Map<string, number>()
  const visibleChildren = (n: MindNode) => (collapsed.has(n.id) ? [] : n.children)

  const measure = (n: MindNode, depth: number): number => {
    const size = sizeOf(n, depth)
    sizes.set(n.id, size)
    const kids = visibleChildren(n)
    const gap = V_GAP[Math.min(depth, 1)]
    const stacked = kids.reduce((sum, c) => sum + measure(c, depth + 1), 0) + gap * Math.max(0, kids.length - 1)
    const h = Math.max(size.height, stacked)
    heights.set(n.id, h)
    return h
  }

  const placed: PlacedNode[] = []
  const rootSize = sizeOf(root, 0)
  sizes.set(root.id, rootSize)
  const rootBox = { x: -rootSize.width / 2, y: -rootSize.height / 2, ...rootSize }
  placed.push({ node: root, parentId: null, ...rootBox, side: 'root', depth: 0, branch: -1 })

  const place = (parent: PlacedNode, kids: MindNode[], side: 'right' | 'left', branchOf: (i: number) => number) => {
    const depth = parent.depth + 1
    const gap = V_GAP[Math.min(parent.depth, 1)]
    const total = kids.reduce((sum, c) => sum + heights.get(c.id)!, 0) + gap * Math.max(0, kids.length - 1)
    let y = parent.y + parent.height / 2 - total / 2
    kids.forEach((child, i) => {
      const band = heights.get(child.id)!
      const size = sizes.get(child.id)!
      const hGap = H_GAP[Math.min(parent.depth, 1)]
      const x = side === 'right' ? parent.x + parent.width + hGap : parent.x - hGap - size.width
      const top = y + band / 2 - size.height / 2
      const p: PlacedNode = { node: child, parentId: parent.node.id, x, y: top, ...size, side, depth, branch: branchOf(i) }
      placed.push(p)
      place(p, visibleChildren(child), side, () => p.branch)
      y += band + gap
    })
  }

  const first = visibleChildren(root)
  for (const c of first) measure(c, 1)
  // Abwechselnd rechts und links: Ein neuer Ast lässt die anderen auf ihrer Seite
  place(placed[0], first.filter((_, i) => i % 2 === 0), 'right', (i) => i * 2)
  place(placed[0], first.filter((_, i) => i % 2 === 1), 'left', (i) => i * 2 + 1)
  return placed
}

/** Geschätzte Größe eines Knotens ohne Browser (z. B. beim Umwandeln in ein Canvas) */
export function estimateNodeSize(text: string, depth: number): Size {
  const charWidth = depth === 0 ? 10 : 8
  const padding = depth === 0 ? 40 : 28
  const maxWidth = depth === 0 ? 320 : 260
  const width = Math.min(maxWidth, Math.max(depth === 0 ? 120 : 60, text.length * charWidth + padding))
  const lines = Math.max(1, Math.ceil((text.length * charWidth) / (maxWidth - padding)))
  return { width: Math.round(width), height: lines * (depth === 0 ? 26 : 22) + (depth === 0 ? 22 : 14) }
}
