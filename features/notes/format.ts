// Formate einer Notiz: Markdown, formatierter Text (HTML aus dem Editor), einfacher Text,
// Mindmap (Markdown-Gliederung) und Canvas (JSON Canvas).
import { htmlToText } from '@/shared/lib/html'
import { canvasText } from '@/features/canvas/canvas'
import type { NoteFormat } from './types'

export const NOTE_FORMAT_IDS = ['markdown', 'richtext', 'text', 'mindmap', 'canvas'] as const satisfies readonly NoteFormat[]

export const NOTE_FORMAT_LABELS: Record<NoteFormat, { label: string; description: string }> = {
  markdown: { label: 'Markdown', description: 'Mit Wikilinks, Callouts und Formeln' },
  richtext: { label: 'Formatierter Text', description: 'Wie in Word: Schrift, Farben, Ausrichtung' },
  text: { label: 'Einfacher Text', description: 'Ohne Formatierung' },
  mindmap: { label: 'Mindmap', description: 'Gedanken als Baum um ein Thema' },
  canvas: { label: 'Canvas', description: 'Freie Fläche mit Karten und Pfeilen' },
}

/** Formate, die als Fläche bearbeitet werden (Mindmap, Canvas) statt als fortlaufender Text */
export const isVisualFormat = (format: NoteFormat) => format === 'mindmap' || format === 'canvas'

/** Text, aus dem Suche, Auszug, Tags und Links berechnet werden */
export function noteText(format: NoteFormat, content: string): string {
  if (format === 'richtext') return htmlToText(content)
  if (format === 'canvas') return canvasText(content)
  return content
}

/** Dateiendung für Export und Download – einfacher Text und Mindmaps als .md, damit Markdown-Editoren sie öffnen */
export function noteExtension(format: NoteFormat): '.md' | '.html' | '.canvas' {
  if (format === 'richtext') return '.html'
  if (format === 'canvas') return '.canvas'
  return '.md'
}
