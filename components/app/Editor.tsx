'use client'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { createExtensions, externalChange, type CompletionData } from '@/lib/client/editor/setup'

export type EditorHandle = {
  view: () => EditorView | null
  focus: () => void
  /** Inhalt komplett ersetzen (z. B. nach Konfliktauflösung) */
  setDoc: (doc: string) => void
}

type Props = {
  initialDoc: string
  onChange: (doc: string) => void
  onSave: () => void
  onPasteFiles: (files: File[]) => void
  data: CompletionData
  autoFocus?: boolean
  spellcheck?: boolean
}

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
      if (!view) return
      const head = Math.min(view.state.selection.main.head, doc.length)
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: doc },
        selection: { anchor: head },
        annotations: externalChange.of(true),
      })
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
