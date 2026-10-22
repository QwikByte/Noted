// Gliederung einer Notiz: Überschriften mit Einrückung und der Abschnitt an der Leseposition (ohne DOM)
import { findHeadings } from '@/shared/markdown/meta'
import { richTextHeadings } from './rich-html'
import type { NoteFormat } from './types'

/** Mehr Einträge zeigt die Gliederung nicht – darunter steht ein Hinweis */
export const MAX_OUTLINE_ENTRIES = 1000

export type OutlineEntry = {
  /** Markdown: Zeile der Überschrift (0-basiert, inklusive Frontmatter) · formatierter Text: Nummer der Überschrift */
  key: number
  level: number
  /** Einrückung relativ zur Gliederung: Auf # folgendes ### rückt nur eine Stufe ein */
  depth: number
  text: string
}

/**
 * Gliederung nur für Markdown und formatierten Text: Einfacher Text liest # nicht als Überschrift, eine Mindmap ist
 * selbst schon eine Gliederung, und die Karten eines Canvas haben keine Reihenfolge
 */
export function hasOutline(format: NoteFormat): boolean {
  return format === 'markdown' || format === 'richtext'
}

export function noteOutline(format: NoteFormat, content: string): { entries: OutlineEntry[]; truncated: boolean } {
  const headings =
    format === 'markdown'
      ? findHeadings(content).map((h) => ({ key: h.line, level: h.level, text: h.text }))
      : format === 'richtext'
        ? // Leere Überschriften fallen weg, behalten aber ihre Nummer – die zählt im DOM mit
          richTextHeadings(content)
            .map((h, i) => ({ key: i, level: h.level, text: h.text }))
            .filter((h) => h.text)
        : []
  const levels: number[] = []
  const entries = headings.slice(0, MAX_OUTLINE_ENTRIES).map((h) => {
    while (levels.length > 0 && levels[levels.length - 1] >= h.level) levels.pop()
    levels.push(h.level)
    return { ...h, depth: levels.length - 1 }
  })
  return { entries, truncated: headings.length > MAX_OUTLINE_ENTRIES }
}

/**
 * Index des aktuellen Eintrags: der letzte, dessen Überschrift an oder vor `position` (Zeile bzw. Nummer an der
 * Lesekante) liegt – vor der ersten Überschrift (`null`) die erste, ganz unten (`atEnd`) die letzte; -1 ohne Einträge
 */
export function currentEntry(entries: OutlineEntry[], position: number | null, atEnd: boolean): number {
  if (entries.length === 0) return -1
  if (atEnd) return entries.length - 1
  if (position === null) return 0
  let lo = 0
  let hi = entries.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (entries[mid].key <= position) lo = mid
    else hi = mid - 1
  }
  return lo
}
