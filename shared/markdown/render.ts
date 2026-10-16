// Markdown → HTML im Obsidian-Stil (ohne DOM; die Bereinigung mit DOMPurify passiert in der Vorschau).
import MarkdownIt, { type PluginSimple } from 'markdown-it'
import footnote from 'markdown-it-footnote'
import katex from '@vscode/markdown-it-katex'
import hljs from 'highlight.js/lib/common'
import { escapeHtml, obsidianPlugin, stripComments, type RenderEnv } from './obsidian'
import { splitFrontmatter } from './meta'

function createMarkdownIt() {
  const md: MarkdownIt = new MarkdownIt({
    html: true,
    linkify: true,
    breaks: true, // Obsidian-Standard: einfacher Zeilenumbruch = Umbruch
    typographer: false,
    highlight(code, lang) {
      const language = lang.trim().toLowerCase()
      if (language && hljs.getLanguage(language)) {
        try {
          return `<pre class="hljs"><code class="language-${escapeHtml(language)}">${hljs.highlight(code, { language, ignoreIllegals: true }).value}</code></pre>`
        } catch {
          /* Fallback unten */
        }
      }
      return `<pre class="hljs"><code>${escapeHtml(code)}</code></pre>`
    },
  })
  // Die Typen von markdown-it-footnote verweisen auf die CJS-Variante von markdown-it – zur Laufzeit identisch
  md.use(footnote as unknown as PluginSimple)
  md.use(katex, { throwOnError: false, enableMathBlockInHtml: true, enableMathInlineInHtml: true, enableFencedBlocks: true })
  md.use(obsidianPlugin)
  md.linkify.set({ fuzzyLink: false })

  // Mermaid-Diagramme: Platzhalter, der in der Vorschau per mermaid.js gerendert wird
  const defaultFence = md.renderer.rules.fence!
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    if (token.info.trim().toLowerCase() === 'mermaid') {
      // Quelltext als Textinhalt (nicht als Attribut – DOMPurify entfernt Attribute mit „-->“)
      return `<div class="mermaid-block"><pre class="mermaid-source">${escapeHtml(token.content)}</pre></div>\n`
    }
    return defaultFence(tokens, idx, options, env, self)
  }
  return md
}

let instance: MarkdownIt | null = null

export type Rendered = {
  html: string
  properties: Record<string, unknown> | null
  /** YAML konnte nicht gelesen werden */
  propertiesError: boolean
}

export function renderMarkdown(content: string, env: RenderEnv = {}): Rendered {
  instance ??= createMarkdownIt()
  const fm = splitFrontmatter(content)
  const body = stripComments(fm ? fm.body : content)
  const html = instance.render(body, { ...env, lineOffset: fm ? fm.lines : 0 })
  return { html, properties: fm?.data ?? null, propertiesError: !!fm && fm.data === null && fm.raw.trim() !== '' }
}
