'use client'
// Format einer Notiz wechseln: Inhalt in das neue Format umwandeln.
import { htmlToText, textToHtml } from '@/shared/lib/html'
import type { NoteFormat } from '../types'

export async function convertContent(content: string, from: NoteFormat, to: NoteFormat): Promise<string> {
  if (from === to) return content
  // Markdown ↔ einfacher Text: Der Text bleibt, wie er ist
  if (from !== 'richtext' && to !== 'richtext') return content
  if (from === 'text') return textToHtml(content)
  if (to === 'text') return htmlToText(content, { codeFences: false })
  const rich = await import('./rich-text')
  return from === 'markdown' ? rich.markdownToHtml(content) : rich.htmlToMarkdown(content)
}
