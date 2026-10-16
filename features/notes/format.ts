// Formate einer Notiz: Markdown (Obsidian), formatierter Text (HTML aus dem Editor), einfacher Text,
// Mindmap (Markdown-Gliederung) und Canvas (JSON Canvas).
import { htmlToText } from '@/shared/lib/html'
import { canvasText } from '@/features/canvas/canvas'
import type { NoteFormat } from './types'

export const NOTE_FORMAT_IDS = ['markdown', 'richtext', 'text', 'mindmap', 'canvas'] as const satisfies readonly NoteFormat[]

export const NOTE_FORMAT_LABELS: Record<NoteFormat, { label: string; description: string }> = {
  markdown: { label: 'Markdown', description: 'Obsidian-Format mit Wikilinks, Callouts und Formeln' },
  richtext: { label: 'Formatierter Text', description: 'Wie in Word: Schrift, Farben, Ausrichtung' },
  text: { label: 'Einfacher Text', description: 'Nur Text, ohne Formatierung' },
  mindmap: { label: 'Mindmap', description: 'Gedanken als Baum, gespeichert als Markdown-Gliederung' },
  canvas: { label: 'Canvas', description: 'Freie Fläche mit Karten und Pfeilen wie Obsidian Canvas' },
}

/** Formate, die als Fläche bearbeitet werden (Mindmap, Canvas) statt als fortlaufender Text */
export const isVisualFormat = (format: NoteFormat) => format === 'mindmap' || format === 'canvas'

/** Text, aus dem Suche, Auszug, Tags und Links berechnet werden */
export function noteText(format: NoteFormat, content: string): string {
  if (format === 'richtext') return htmlToText(content)
  if (format === 'canvas') return canvasText(content)
  return content
}

/** Dateiendung für Export und Download – einfacher Text und Mindmaps als .md, damit Obsidian sie als Notiz anzeigt */
export function noteExtension(format: NoteFormat): '.md' | '.html' | '.canvas' {
  if (format === 'richtext') return '.html'
  if (format === 'canvas') return '.canvas'
  return '.md'
}
