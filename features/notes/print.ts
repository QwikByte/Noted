// Was von einer Notiz gedruckt wird – reine Logik für die Druckansicht (NotePrint)
import { splitFrontmatter } from '@/shared/markdown/meta'
import { mindmapToMarkdown } from '@/features/mindmap/mindmap'
import { canvasToMarkdown, parseCanvas } from '@/features/canvas/canvas'
import type { NoteFormat } from './types'

/**
 * Markdown für den Druck: Mindmaps als Gliederung, Canvas als Text der Karten in Lesereihenfolge. Ohne `properties`
 * nur der Rumpf. `markdown` ist `null` bei formatiertem und einfachem Text – die druckt ihre eigene Leseansicht.
 */
export function noteMarkdownForPrint(
  format: NoteFormat,
  content: string,
  opts: { properties: boolean },
): { markdown: string | null; hasProperties: boolean } {
  if (format === 'richtext' || format === 'text') return { markdown: null, hasProperties: false }
  const markdown =
    format === 'mindmap'
      ? mindmapToMarkdown(content)
      : format === 'canvas'
        ? canvasToMarkdown(parseCanvas(content) ?? { nodes: [], edges: [] })
        : content
  const fm = splitFrontmatter(markdown)
  const hasProperties = !!fm?.raw.trim()
  return { markdown: fm && !opts.properties ? fm.body : markdown, hasProperties }
}
