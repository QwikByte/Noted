'use client'
// Editor für formatierten Text (TipTap): Erweiterungen und Umwandlung zwischen HTML und Markdown.
// Wird erst geladen, wenn eine Notiz mit formatiertem Text geöffnet oder umgewandelt wird.
import { Editor, type AnyExtension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Color, FontSize, TextStyle } from '@tiptap/extension-text-style'
import { Highlight } from '@tiptap/extension-highlight'
import { TextAlign } from '@tiptap/extension-text-align'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Image } from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import { Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
import { splitFrontmatter } from '@/shared/markdown/meta'
import { defaultFileUrl } from '@/shared/markdown/syntax'

function baseExtensions({ underline }: { underline: boolean }): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      underline: underline ? {} : false,
    }),
    TextStyle,
    Color,
    FontSize,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Image,
    TableKit.configure({ table: { resizable: false } }),
  ]
}

/** Erweiterungen des Editors */
export function richTextExtensions(opts: { placeholder: string }): AnyExtension[] {
  return [...baseExtensions({ underline: true }), Placeholder.configure({ placeholder: opts.placeholder })]
}

const IMAGE_EMBED = /!\[\[([^\]|#\n]+\.(?:png|jpe?g|gif|webp|avif|bmp|svg))(?:\|[^\]\n]*)?\]\]/gi
const FILE_IMAGE = /!\[[^\]\n]*\]\(\/api\/files\/([^)\s]+)\)/g

/** Editor ohne Anzeige – nur zum Umwandeln */
function convert(content: string, contentType: 'html' | 'markdown', read: (editor: Editor) => string): string {
  // Unterstreichen gibt es in Markdown nicht (TipTap schriebe „++Text++“) – beim Umwandeln weglassen
  const editor = new Editor({ element: null, extensions: [...baseExtensions({ underline: false }), Markdown], content, contentType })
  try {
    return read(editor)
  } finally {
    editor.destroy()
  }
}

/**
 * Markdown → formatierter Text. Properties (Frontmatter) entfallen; Markdown-Elemente ohne Entsprechung
 * (Callouts, Formeln, Wikilinks) bleiben als Text stehen. Eingebettete Bilder bleiben Bilder.
 */
export function markdownToHtml(markdown: string): string {
  const body = splitFrontmatter(markdown)?.body ?? markdown
  const prepared = body.replace(IMAGE_EMBED, (_m, name: string) => `![](${defaultFileUrl(name.trim())})`)
  if (!prepared.trim()) return ''
  return convert(prepared, 'markdown', (e) => (e.isEmpty ? '' : e.getHTML()))
}

/** Formatierter Text → Markdown. Farben, Schriftgrößen, Ausrichtung und Unterstreichung entfallen. */
export function htmlToMarkdown(html: string): string {
  if (!html.trim()) return ''
  const markdown = convert(html, 'html', (e) => e.getMarkdown())
  // Bilder aus Noted als Einbettung ![[…]]
  return markdown.replace(FILE_IMAGE, (m, path: string) => {
    try {
      return `![[${decodeURIComponent(path)}]]`
    } catch {
      return m
    }
  })
}
