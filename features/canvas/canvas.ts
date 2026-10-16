// Canvas im offenen Format „JSON Canvas“ (https://jsoncanvas.org), wie Obsidian es für .canvas-Dateien nutzt:
// Karten (Text, Datei bzw. Notiz, Link, Gruppe) auf einer freien Fläche und Pfeile zwischen ihnen.
// Dateikarten verweisen in Noted wie Wikilinks auf den Namen (Notiztitel oder Anhang); erst der Export
// schreibt den vollständigen Pfad im Vault (siehe canvasForExport).
import { isFileTarget, linkKey } from '@/shared/markdown/meta'

export type CanvasSide = 'top' | 'right' | 'bottom' | 'left'
export type CanvasEnd = 'none' | 'arrow'

type NodeBase = { id: string; x: number; y: number; width: number; height: number; color?: string }
export type CanvasTextNode = NodeBase & { type: 'text'; text: string }
export type CanvasFileNode = NodeBase & { type: 'file'; file: string; subpath?: string }
export type CanvasLinkNode = NodeBase & { type: 'link'; url: string }
export type CanvasGroupNode = NodeBase & { type: 'group'; label?: string }
export type CanvasNode = CanvasTextNode | CanvasFileNode | CanvasLinkNode | CanvasGroupNode

export type CanvasEdge = {
  id: string
  fromNode: string
  fromSide?: CanvasSide
  fromEnd?: CanvasEnd
  toNode: string
  toSide?: CanvasSide
  /** Standard laut Format: Pfeil am Ziel */
  toEnd?: CanvasEnd
  color?: string
  label?: string
}

export type CanvasData = { nodes: CanvasNode[]; edges: CanvasEdge[] }

/** Farben wie in Obsidian: „1“ bis „6“ oder ein Hex-Wert */
export const CANVAS_COLORS = [
  { id: '1', label: 'Rot' },
  { id: '2', label: 'Orange' },
  { id: '3', label: 'Gelb' },
  { id: '4', label: 'Grün' },
  { id: '5', label: 'Türkis' },
  { id: '6', label: 'Lila' },
] as const

export const CANVAS_NODE_SIZE = {
  text: { width: 260, height: 120 },
  note: { width: 400, height: 320 },
  file: { width: 320, height: 240 },
  link: { width: 360, height: 96 },
  group: { width: 520, height: 380 },
} as const

export const MIN_NODE_SIZE = 40

const SIDES: readonly string[] = ['top', 'right', 'bottom', 'left']
const ENDS: readonly string[] = ['none', 'arrow']

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const str = (v: unknown) => (typeof v === 'string' ? v : undefined)

/** Zufällige ID wie in Obsidian (16 Hex-Zeichen) */
export function newCanvasId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// Unbekannte Felder (z. B. von Obsidian-Plugins) bleiben erhalten: Die Karte wird nur ergänzt, nicht neu gebaut
function parseNode(raw: unknown): CanvasNode | null {
  if (!isObject(raw) || typeof raw.id !== 'string' || !raw.id) return null
  const base = {
    ...raw,
    id: raw.id,
    x: num(raw.x, 0),
    y: num(raw.y, 0),
    width: Math.max(MIN_NODE_SIZE, num(raw.width, CANVAS_NODE_SIZE.text.width)),
    height: Math.max(MIN_NODE_SIZE, num(raw.height, CANVAS_NODE_SIZE.text.height)),
    color: str(raw.color),
  }
  switch (raw.type) {
    case 'text':
      return { ...base, type: 'text', text: str(raw.text) ?? '' }
    case 'file': {
      const file = str(raw.file)
      return file ? { ...base, type: 'file', file, subpath: str(raw.subpath) } : null
    }
    case 'link': {
      const url = str(raw.url)
      return url ? { ...base, type: 'link', url } : null
    }
    case 'group':
      return { ...base, type: 'group', label: str(raw.label) }
    default:
      return null
  }
}

function parseEdge(raw: unknown, ids: Set<string>): CanvasEdge | null {
  if (!isObject(raw) || typeof raw.id !== 'string' || !raw.id) return null
  const { fromNode, toNode } = raw
  if (typeof fromNode !== 'string' || typeof toNode !== 'string' || !ids.has(fromNode) || !ids.has(toNode)) return null
  const side = (v: unknown) => (typeof v === 'string' && SIDES.includes(v) ? (v as CanvasSide) : undefined)
  const end = (v: unknown) => (typeof v === 'string' && ENDS.includes(v) ? (v as CanvasEnd) : undefined)
  return {
    ...raw,
    id: raw.id,
    fromNode,
    toNode,
    fromSide: side(raw.fromSide),
    toSide: side(raw.toSide),
    fromEnd: end(raw.fromEnd),
    toEnd: end(raw.toEnd),
    color: str(raw.color),
    label: str(raw.label),
  }
}

/** Liest ein Canvas; leerer Inhalt ist ein leeres Canvas, `null` heißt: kein gültiges JSON Canvas */
export function parseCanvas(json: string): CanvasData | null {
  if (!json.trim()) return { nodes: [], edges: [] }
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }
  if (!isObject(raw)) return null
  if ((raw.nodes !== undefined && !Array.isArray(raw.nodes)) || (raw.edges !== undefined && !Array.isArray(raw.edges))) return null
  const nodes: CanvasNode[] = []
  const ids = new Set<string>()
  for (const r of (raw.nodes as unknown[] | undefined) ?? []) {
    const n = parseNode(r)
    if (n && !ids.has(n.id)) {
      ids.add(n.id)
      nodes.push(n)
    }
  }
  const edges: CanvasEdge[] = []
  const edgeIds = new Set<string>()
  for (const r of (raw.edges as unknown[] | undefined) ?? []) {
    const e = parseEdge(r, ids)
    if (e && !edgeIds.has(e.id)) {
      edgeIds.add(e.id)
      edges.push(e)
    }
  }
  return { nodes, edges }
}

/** Schreibt wie Obsidian: eine Karte bzw. ein Pfeil pro Zeile (gut lesbare Änderungen, kompakte Datei) */
export function serializeCanvas(data: CanvasData): string {
  const list = (items: object[]) => (items.length ? `[\n${items.map((i) => `\t\t${JSON.stringify(i)}`).join(',\n')}\n\t]` : '[]')
  return `{\n\t"nodes":${list(data.nodes)},\n\t"edges":${list(data.edges)}\n}\n`
}

/** Karten ändern – unverändert bleibt der Inhalt Zeichen für Zeichen gleich */
export function mapCanvasNodes(json: string, fn: (node: CanvasNode) => CanvasNode): string {
  const data = parseCanvas(json)
  if (!data) return json
  let changed = false
  const nodes = data.nodes.map((n) => {
    const next = fn(n)
    if (next !== n) changed = true
    return next
  })
  return changed ? serializeCanvas({ ...data, nodes }) : json
}

type Box = Pick<NodeBase, 'x' | 'y' | 'width' | 'height'>

const center = (n: Box) => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 })
const contains = (outer: Box, inner: Box) => {
  const c = center(inner)
  return outer !== inner && c.x >= outer.x && c.x <= outer.x + outer.width && c.y >= outer.y && c.y <= outer.y + outer.height
}

/** Karten, die (mit ihrem Mittelpunkt) in einer Gruppe liegen – sie werden mit der Gruppe verschoben */
export function nodesInGroup(nodes: readonly CanvasNode[], group: CanvasNode): CanvasNode[] {
  return nodes.filter((n) => contains(group, n))
}

/** Seiten, an denen ein Pfeil zwischen zwei Karten ansetzt, wenn die Datei keine angibt */
export function nearestSides(from: Box, to: Box): [CanvasSide, CanvasSide] {
  const a = center(from)
  const b = center(to)
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ['right', 'left'] : ['left', 'right']
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom']
}

const byPosition = (a: Box, b: Box) => a.y - b.y || a.x - b.x

function nodeMarkdown(n: CanvasNode): string {
  if (n.type === 'text') return n.text.trim()
  if (n.type === 'file') return `${isFileTarget(n.file) ? '!' : ''}[[${n.file}${n.subpath ?? ''}]]`
  if (n.type === 'link') return n.url
  return n.label?.trim() ? `## ${n.label.trim()}` : ''
}

/**
 * Inhalt als Markdown in Lesereihenfolge (von oben nach unten): Gruppen werden zu Überschriften mit ihren Karten
 * darunter, Dateikarten zu Wikilinks bzw. Einbettungen. Anordnung, Pfeile und Farben entfallen.
 */
export function canvasToMarkdown(data: CanvasData): string {
  const groups = data.nodes.filter((n) => n.type === 'group')
  // Jede Karte gehört zur kleinsten Gruppe, in der sie liegt
  const owner = new Map<string, CanvasNode>()
  for (const n of data.nodes) {
    if (n.type === 'group') continue
    const g = groups.filter((grp) => contains(grp, n)).sort((a, b) => a.width * a.height - b.width * b.height)[0]
    if (g) owner.set(n.id, g)
  }
  const blocks = [...groups, ...data.nodes.filter((n) => n.type !== 'group' && !owner.has(n.id))].sort(byPosition)
  const parts: string[] = []
  for (const block of blocks) {
    parts.push(nodeMarkdown(block))
    if (block.type !== 'group') continue
    const members = data.nodes.filter((n) => owner.get(n.id) === block).sort(byPosition)
    parts.push(...members.map(nodeMarkdown))
  }
  return parts.filter(Boolean).join('\n\n')
}

/** Text, aus dem Suche, Auszug, Tags und Links eines Canvas berechnet werden (inkl. Beschriftungen der Pfeile) */
export function canvasText(json: string): string {
  const data = parseCanvas(json)
  if (!data) return ''
  const labels = data.edges.map((e) => e.label?.trim() ?? '').filter(Boolean)
  return [canvasToMarkdown(data), ...labels].filter(Boolean).join('\n\n')
}

/** Ein Canvas mit einer einzigen Textkarte (beim Umwandeln aus einem Textformat) */
export function canvasWithText(markdown: string): CanvasData {
  const text = markdown.trim()
  if (!text) return { nodes: [], edges: [] }
  const lines = text.split('\n').reduce((sum, l) => sum + Math.max(1, Math.ceil(l.length / 60)), 0)
  const height = Math.min(900, Math.max(CANVAS_NODE_SIZE.text.height, lines * 24 + 48))
  return { nodes: [{ id: newCanvasId(), type: 'text', text, x: -280, y: -Math.round(height / 2), width: 560, height }], edges: [] }
}

/** Was der Export über Notizen und Anhänge wissen muss */
export type VaultIndex = {
  attachmentFolder: string
  attachments: Iterable<string>
  /** Pfad im Vault (mit Endung) je Notiz, Schlüssel: linkKey(Titel) */
  notePaths: ReadonlyMap<string, string>
}

/** Für den Export: Dateikarten verweisen auf den vollständigen Pfad im Vault, wie Obsidian ihn erwartet */
export function canvasForExport(json: string, index: VaultIndex): string {
  if (!json.trim()) return serializeCanvas({ nodes: [], edges: [] })
  const attachments = new Map(Array.from(index.attachments, (a) => [a.toLowerCase(), a]))
  return mapCanvasNodes(json, (n) => {
    if (n.type !== 'file') return n
    const attachment = attachments.get(n.file.toLowerCase())
    const path = attachment ? `${index.attachmentFolder}/${attachment}` : index.notePaths.get(linkKey(n.file))
    return path && path !== n.file ? { ...n, file: path } : n
  })
}
