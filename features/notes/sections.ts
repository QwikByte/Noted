// Abschnitte einer Notiz (für ![[Notiz#Abschnitt]]) – reine Logik ohne Browser oder Server
import { findHeadings, headingKey, splitFrontmatter } from '@/shared/markdown/meta'

/**
 * Abschnitt einer Notiz: von der Überschrift bis vor die nächste gleicher oder höherer Ebene, also samt
 * Unterabschnitten. Ohne Überschrift die ganze Notiz ohne Frontmatter. null, wenn es die Überschrift nicht gibt.
 */
export function noteSection(content: string, heading: string | null): string | null {
  const text = content.replace(/\r\n?/g, '\n')
  if (!heading?.trim()) {
    const fm = splitFrontmatter(text)
    return (fm ? fm.body : text).trim()
  }
  const key = headingKey(heading)
  const headings = findHeadings(text)
  const i = headings.findIndex((h) => headingKey(h.raw) === key || headingKey(h.text) === key)
  if (i < 0) return null
  const start = headings[i]
  const end = headings.slice(i + 1).find((h) => h.level <= start.level)
  const lines = text.split('\n')
  return lines.slice(start.line, end?.line ?? lines.length).join('\n').trim()
}
