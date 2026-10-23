'use client'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { createExtensions, type CompletionData } from '../client/editor/setup'
import { docReplacement } from '../client/editor/replace'
import type { EditorLinkActions } from '../client/editor/links'
import { insertionToMarkdown } from '../client/active-editor'
import type { NoteEditorHandle } from '../client/editor-handle'
import { attachmentMarkdown } from '@/features/attachments/client/upload'

export type EditorHandle = NoteEditorHandle & {
  view: () => EditorView | null
  /** Inhalt ersetzen, den der Aufrufer selbst speichert (Aufgabe abgehakt, Mindmap daneben) – mit Strg+Z rückgängig */
  replaceDoc: (doc: string) => void
}

type Props = {
  initialDoc: string
  onChange: (doc: string) => void
  onSave: () => void
  onPasteFiles: (files: File[]) => void
  data: CompletionData
  autoFocus?: boolean
  spellcheck?: boolean
  /** Einfacher Text statt Markdown */
  plain?: boolean
  /** Menü mit Befehlen nach „/“ – wirkt beim Öffnen */
  slashCommands?: boolean
  /** Links per Strg/⌘-Klick öffnen und beim Überfahren zeigen */
  links?: EditorLinkActions
}

const NO_LINKS: EditorLinkActions = { open: () => {}, describe: () => null }

/** Editor für Markdown und einfachen Text (CodeMirror) */
export const Editor = forwardRef<EditorHandle, Props>(function Editor(props, ref) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const latest = useRef(props)
  useEffect(() => {
    latest.current = props
  })

  useImperativeHandle(ref, () => ({
    view: () => viewRef.current,
    focus: () => viewRef.current?.focus(),
    setDoc: (doc: string) => {
      const view = viewRef.current
      if (view) view.dispatch(docReplacement(view.state.doc, doc, false))
    },
    replaceDoc: (doc: string) => {
      const view = viewRef.current
      if (view) view.dispatch(docReplacement(view.state.doc, doc, true))
    },
    insert: (insertion) => {
      const view = viewRef.current
      if (!view) return
      const doc = view.state.doc
      let { from, to } = view.state.selection.main
      // Cursor nie gesetzt (ganz am Anfang)? Dann ans Ende
      if (from === 0 && to === 0 && doc.length > 0 && !view.hasFocus) from = to = doc.length
      const before = doc.sliceString(Math.max(0, from - 2), from)
      const prefix = from === 0 || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
      const insert = prefix + insertionToMarkdown(insertion) + (doc.sliceString(to, to + 1) === '\n' ? '\n' : '\n\n')
      view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true })
    },
    insertAttachment: (att) => {
      const view = viewRef.current
      if (!view) return
      const md = attachmentMarkdown(att)
      const { from, to } = view.state.selection.main
      const line = view.state.doc.lineAt(from)
      const prefix = from > line.from && line.text.trim() ? '\n' : ''
      view.dispatch({ changes: { from, to, insert: prefix + md + '\n' }, selection: { anchor: from + prefix.length + md.length + 1 } })
      view.focus()
    },
    selectedText: () => {
      const view = viewRef.current
      return view ? view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) : ''
    },
  }))

  useEffect(() => {
    if (!host.current) return
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: latest.current.initialDoc,
        extensions: createExtensions({
          data: {
            titles: () => latest.current.data.titles(),
            tags: () => latest.current.data.tags(),
            files: () => latest.current.data.files(),
          },
          onChange: (doc) => latest.current.onChange(doc),
          onSave: () => latest.current.onSave(),
          onPasteFiles: (files) => latest.current.onPasteFiles(files),
          spellcheck: latest.current.spellcheck,
          plain: latest.current.plain,
          slashCommands: latest.current.slashCommands,
          links: latest.current.links ? () => latest.current.links ?? NO_LINKS : undefined,
        }),
      }),
    })
    viewRef.current = view
    if (latest.current.autoFocus) {
      view.focus()
      view.dispatch({ selection: { anchor: view.state.doc.length } })
    }
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  return <div ref={host} className="h-full min-h-0" data-testid="editor" />
})
