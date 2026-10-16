'use client'
// Format einer Notiz wechseln: Inhalt in das neue Format umwandeln.
import { htmlToText, textToHtml } from '@/shared/lib/html'
import {
  branchSwatch,
  layoutMindmap,
  mindmapPropertiesOf,
  mindmapToMarkdown,
  parseMindmap,
  serializeMindmap,
  type MindNode,
} from '@/features/mindmap/mindmap'
import {
  canvasToMarkdown,
  canvasWithText,
  newCanvasId,
  parseCanvas,
  serializeCanvas,
  type CanvasData,
} from '@/features/canvas/canvas'
import type { NoteFormat } from '../types'

/** Ungefähre Größe einer Textkarte im Canvas (ohne Browser gemessen) */
function cardSize(text: string, depth: number) {
  const charWidth = depth === 0 ? 13 : 8.5
  const maxWidth = depth === 0 ? 360 : 300
  const width = Math.min(maxWidth, Math.max(120, text.length * charWidth + 48))
  const lines = Math.max(1, Math.ceil((text.length * charWidth) / (width - 48)))
  return { width: Math.round(width / 10) * 10, height: Math.round((lines * (depth === 0 ? 34 : 24) + 42) / 10) * 10 }
}

/** Mindmap → Canvas: jeder Knoten eine Karte an seiner Stelle, die Äste als Linien */
function mindmapToCanvas(root: MindNode): CanvasData {
  const placed = layoutMindmap(root, (n, depth) => cardSize(n.text, depth), new Set())
  const ids = new Map(placed.map((p) => [p.node.id, newCanvasId()]))
  return {
    nodes: placed.map((p) => ({
      id: ids.get(p.node.id)!,
      type: 'text',
      text: p.depth === 0 ? `# ${p.node.text}` : p.node.text,
      x: Math.round(p.x),
      y: Math.round(p.y),
      width: p.width,
      height: p.height,
      color: p.depth > 0 ? String(branchSwatch(p.branch)) : undefined,
    })),
    edges: placed
      .filter((p) => p.parentId)
      .map((p) => ({
        id: newCanvasId(),
        fromNode: ids.get(p.parentId!)!,
        fromSide: p.side === 'left' ? 'left' : 'right',
        toNode: ids.get(p.node.id)!,
        toSide: p.side === 'left' ? 'right' : 'left',
        toEnd: 'none',
        color: String(branchSwatch(p.branch)),
      })),
  }
}

/** Inhalt als Markdown – Ausgangspunkt für Mindmap, Canvas und formatierten Text */
async function asMarkdown(content: string, from: NoteFormat): Promise<string> {
  if (from === 'mindmap') return mindmapToMarkdown(content)
  if (from === 'canvas') return canvasToMarkdown(parseCanvas(content) ?? { nodes: [], edges: [] })
  if (from === 'richtext') return (await import('./rich-text')).htmlToMarkdown(content)
  return content
}

export async function convertContent(content: string, from: NoteFormat, to: NoteFormat, title: string): Promise<string> {
  if (from === to) return content
  if (to === 'mindmap') {
    // Einfacher Text: jede Zeile ein Punkt
    const markdown =
      from === 'text'
        ? content
            .split(/\r?\n/)
            .filter((l) => l.trim())
            .map((l) => `- ${l.trim()}`)
            .join('\n')
        : await asMarkdown(content, from)
    const properties = from === 'markdown' ? mindmapPropertiesOf(content) : null
    return serializeMindmap(parseMindmap(markdown, title), properties)
  }
  if (to === 'canvas') {
    if (from === 'mindmap') return serializeCanvas(mindmapToCanvas(parseMindmap(content, title)))
    return serializeCanvas(canvasWithText(await asMarkdown(content, from)))
  }
  if (from === 'mindmap' || from === 'canvas') {
    const markdown = await asMarkdown(content, from)
    if (to === 'richtext') return (await import('./rich-text')).markdownToHtml(markdown)
    return markdown
  }
  // Markdown ↔ einfacher Text: Der Text bleibt, wie er ist
  if (from !== 'richtext' && to !== 'richtext') return content
  if (from === 'text') return textToHtml(content)
  if (to === 'text') return htmlToText(content, { codeFences: false })
  const rich = await import('./rich-text')
  return from === 'markdown' ? rich.markdownToHtml(content) : rich.htmlToMarkdown(content)
}
