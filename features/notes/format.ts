// Formate einer Notiz: Markdown (Obsidian), formatierter Text (HTML aus dem Editor) und einfacher Text.
import { htmlToText } from '@/shared/lib/html'
import type { NoteFormat } from './types'

export const NOTE_FORMAT_IDS = ['markdown', 'richtext', 'text'] as const satisfies readonly NoteFormat[]

export const NOTE_FORMAT_LABELS: Record<NoteFormat, { label: string; description: string }> = {
  markdown: { label: 'Markdown', description: 'Obsidian-Format mit Wikilinks, Callouts und Formeln' },
  richtext: { label: 'Formatierter Text', description: 'Wie in Word: Schrift, Farben, Ausrichtung' },
  text: { label: 'Einfacher Text', description: 'Nur Text, ohne Formatierung' },
}

/** Text, aus dem Suche, Auszug, Tags und Links berechnet werden */
export function noteText(format: NoteFormat, content: string): string {
  return format === 'richtext' ? htmlToText(content) : content
}

/** Dateiendung für Export und Download – einfacher Text als .md, damit Obsidian ihn als Notiz anzeigt */
export function noteExtension(format: NoteFormat): '.md' | '.html' {
  return format === 'richtext' ? '.html' : '.md'
}
