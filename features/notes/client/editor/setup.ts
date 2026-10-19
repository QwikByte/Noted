'use client'
import { Annotation, EditorState, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  keymap,
  placeholder as placeholderExt,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { yamlFrontmatter } from '@codemirror/lang-yaml'
import { languages } from '@codemirror/language-data'
import { HighlightStyle, syntaxHighlighting, indentUnit } from '@codemirror/language'
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { tags as t } from '@lezer/highlight'
import { wrapSelection } from './commands'

const highlightStyle = HighlightStyle.define([
  { tag: t.heading1, class: 'cm-md-h1' },
  { tag: t.heading2, class: 'cm-md-h2' },
  { tag: t.heading3, class: 'cm-md-h3' },
  { tag: t.heading4, class: 'cm-md-h4' },
  { tag: t.heading5, class: 'cm-md-h5' },
  { tag: t.heading6, class: 'cm-md-h6' },
  { tag: t.strong, fontWeight: '650' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.processingInstruction, class: 'cm-md-mark' },
  { tag: t.monospace, class: 'cm-md-code' },
  { tag: t.link, class: 'cm-md-link' },
  { tag: t.url, class: 'cm-md-url' },
  { tag: t.quote, class: 'cm-md-quote' },
  { tag: t.contentSeparator, class: 'cm-md-mark' },
  { tag: t.labelName, class: 'cm-md-mark' },
  // Code-Blöcke und YAML-Frontmatter
  { tag: [t.keyword, t.modifier, t.operatorKeyword], class: 'hljs-keyword' },
  { tag: [t.string, t.special(t.string), t.regexp], class: 'hljs-string' },
  { tag: [t.number, t.bool, t.null, t.atom], class: 'hljs-number' },
  { tag: [t.comment, t.lineComment, t.blockComment], class: 'hljs-comment' },
  { tag: [t.function(t.variableName), t.definition(t.variableName), t.className, t.typeName], class: 'hljs-title' },
  { tag: [t.propertyName, t.attributeName], class: 'hljs-attr' },
  { tag: t.meta, class: 'cm-md-mark' },
])

// Erweiterte Syntax, die der Markdown-Parser nicht kennt: [[Links]], #Tags, ==Markierungen==, $Formeln$, %%Kommentare%%
const EXTENDED_SYNTAX_RE =
  /(!?\[\[[^\]\n]+\]\])|((?<=^|\s)#[\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)|(==[^=\n]+==)|(\$\$[^$]+\$\$|\$[^$\n]+\$)|(%%[\s\S]*?%%)/gu

const marks = {
  wikilink: Decoration.mark({ class: 'cm-md-wikilink' }),
  tag: Decoration.mark({ class: 'cm-md-tag' }),
  highlight: Decoration.mark({ class: 'cm-md-highlight' }),
  math: Decoration.mark({ class: 'cm-md-math' }),
  comment: Decoration.mark({ class: 'cm-md-comment' }),
}

const extendedSyntaxDecorator = new MatchDecorator({
  regexp: EXTENDED_SYNTAX_RE,
  decoration: (m) =>
    m[1] ? marks.wikilink : m[2] ? marks.tag : m[3] ? marks.highlight : m[4] ? marks.math : marks.comment,
})

const extendedSyntaxHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = extendedSyntaxDecorator.createDeco(view)
    }
    update(u: ViewUpdate) {
      this.decorations = extendedSyntaxDecorator.updateDeco(u, this.decorations)
    }
  },
  { decorations: (v) => v.decorations },
)

/** Markiert programmatische Änderungen (z. B. Inhalt vom Server), die nicht gespeichert werden sollen. */
export const externalChange = Annotation.define<boolean>()

export type CompletionData = {
  titles: () => string[]
  tags: () => string[]
  files: () => string[]
}

const CALLOUT_TYPES = [
  ['note', 'Notiz'],
  ['info', 'Info'],
  ['tip', 'Tipp'],
  ['important', 'Wichtig'],
  ['summary', 'Zusammenfassung'],
  ['example', 'Beispiel'],
  ['question', 'Frage'],
  ['warning', 'Achtung'],
  ['danger', 'Gefahr'],
  ['success', 'Erledigt'],
  ['todo', 'Aufgabe'],
  ['quote', 'Zitat'],
  ['bug', 'Fehler'],
  ['failure', 'Fehlgeschlagen'],
  ['abstract', 'Abstract'],
]

function completions(data: CompletionData) {
  return (ctx: CompletionContext): CompletionResult | null => {
    // [[Wikilinks]] und ![[Einbettungen]]
    const link = ctx.matchBefore(/!?\[\[[^\]\n|#]*$/)
    if (link) {
      const embed = link.text.startsWith('!')
      const from = link.from + (embed ? 3 : 2)
      const after = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2)
      const close = after === ']]' ? '' : ']]'
      const options: Completion[] = data.titles().map((title) => ({
        label: title,
        type: 'text',
        apply: title + close,
        boost: 1,
      }))
      if (embed) {
        for (const file of data.files()) options.push({ label: file, type: 'variable', detail: 'Datei', apply: file + close })
      }
      return { from, options, validFor: /^[^\]\n|#]*$/ }
    }
    // Callout-Typen nach "> [!"
    const callout = ctx.matchBefore(/^\s*>\s*\[![\w-]*$/)
    if (callout) {
      const from = callout.from + callout.text.indexOf('[!') + 2
      return {
        from,
        options: CALLOUT_TYPES.map(([type, label]) => ({ label: type, detail: label, type: 'keyword', apply: `${type}] ` })),
        validFor: /^[\w-]*$/,
      }
    }
    // #Tags
    const tag = ctx.matchBefore(/(?<=^|\s)#[\p{L}\p{N}_\-/]*$/u)
    if (tag && (tag.text.length > 1 || ctx.explicit)) {
      const tags = data.tags()
      if (!tags.length) return null
      return {
        from: tag.from + 1,
        options: tags.map((t) => ({ label: t, type: 'keyword' })),
        validFor: /^[\p{L}\p{N}_\-/]*$/u,
      }
    }
    return null
  }
}

const theme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'var(--text)' },
  '.cm-content': { fontFamily: 'var(--font-sans)', padding: '8px 0 40vh' },
  '.cm-line': { padding: '0 20px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-gutters': { display: 'none' },
})

/**
 * Erweiterungen für Markdown – mit `plain` für einfachen Text: ohne Hervorhebung, Autovervollständigung,
 * Formatierungskürzel und Anhänge.
 */
export function createExtensions(opts: {
  data: CompletionData
  onChange: (doc: string) => void
  onSave: () => void
  onPasteFiles: (files: File[]) => void
  placeholder?: string
  spellcheck?: boolean
  plain?: boolean
}): Extension[] {
  const common: Extension[] = [
    history(),
    EditorView.lineWrapping,
    EditorState.tabSize.of(4),
    indentUnit.of('    '),
    theme,
    search({ top: true }),
    highlightSelectionMatches(),
    placeholderExt(opts.placeholder ?? 'Schreib los …'),
    EditorView.contentAttributes.of(
      opts.spellcheck === false
        ? { spellcheck: 'false', autocorrect: 'off', autocapitalize: 'sentences', lang: 'de' }
        : { spellcheck: 'true', autocorrect: 'on', autocapitalize: 'sentences', lang: 'de' },
    ),
    EditorView.updateListener.of((u) => {
      if (u.docChanged && !u.transactions.some((tr) => tr.annotation(externalChange))) {
        opts.onChange(u.state.doc.toString())
      }
    }),
  ]
  const save = { key: 'Mod-s', preventDefault: true, run: () => (opts.onSave(), true) }
  if (opts.plain) {
    return [...common, keymap.of([save, ...searchKeymap, ...historyKeymap, indentWithTab, ...defaultKeymap])]
  }
  return [
    ...common,
    yamlFrontmatter({
      content: markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true }),
    }),
    syntaxHighlighting(highlightStyle),
    extendedSyntaxHighlight,
    closeBrackets(),
    autocompletion({ override: [completions(opts.data)], icons: false, activateOnTyping: true }),
    keymap.of([
      save,
      { key: 'Mod-b', preventDefault: true, run: (v) => (wrapSelection(v, '**', '**', 'fett'), true) },
      { key: 'Mod-i', preventDefault: true, run: (v) => (wrapSelection(v, '*', '*', 'kursiv'), true) },
      { key: 'Mod-Shift-h', preventDefault: true, run: (v) => (wrapSelection(v, '==', '==', 'wichtig'), true) },
      ...closeBracketsKeymap,
      ...completionKeymap,
      ...searchKeymap,
      ...historyKeymap,
      indentWithTab,
      ...defaultKeymap,
    ]),
    EditorView.domEventHandlers({
      paste(event) {
        const files = Array.from(event.clipboardData?.files ?? [])
        if (files.length === 0) return false
        event.preventDefault()
        opts.onPasteFiles(files)
        return true
      },
      drop(event) {
        const files = Array.from(event.dataTransfer?.files ?? [])
        if (files.length === 0) return false
        event.preventDefault()
        opts.onPasteFiles(files)
        return true
      },
    }),
  ]
}
