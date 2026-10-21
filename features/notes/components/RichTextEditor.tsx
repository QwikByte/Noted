'use client'
// Editor für formatierten Text. Wird per next/dynamic nachgeladen (TipTap ist groß) und gibt der Notizansicht
// dieselbe Schnittstelle wie der Markdown-Editor.
import { useEffect, useImperativeHandle, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { richTextExtensions } from '../client/rich-text'
import { attachmentHtml, insertionToHtml } from '../rich-html'
import { RichTextToolbar } from './RichTextToolbar'
import type { NoteEditorHandle } from '../client/editor-handle'

type Props = {
  handleRef: React.Ref<NoteEditorHandle>
  initialHtml: string
  onChange: (html: string) => void
  onSave: () => void
  onUpload: (files: File[]) => void
  onCreateCard: () => void
  autoFocus?: boolean
  spellcheck?: boolean
  /** Über dem Text, z. B. das Titelfeld */
  header: React.ReactNode
}

function droppedFiles(event: ClipboardEvent | DragEvent): File[] {
  const list = 'clipboardData' in event ? event.clipboardData?.files : event.dataTransfer?.files
  return Array.from(list ?? [])
}

export default function RichTextEditor(props: Props) {
  const latest = useRef(props)
  useEffect(() => {
    latest.current = props
  })

  const editor = useEditor({
    extensions: richTextExtensions({ placeholder: 'Schreib los …' }),
    content: props.initialHtml,
    immediatelyRender: false,
    autofocus: props.autoFocus ? 'end' : false,
    editorProps: {
      attributes: {
        class: 'markdown-body rich-text',
        'aria-label': 'Notiztext',
        'aria-multiline': 'true',
        spellcheck: String(props.spellcheck !== false),
        lang: 'de',
        'data-testid': 'rich-editor',
      },
      handleKeyDown: (_view, event) => {
        if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 's') return false
        event.preventDefault()
        latest.current.onSave()
        return true
      },
      // Dateien aus der Zwischenablage oder per Drag & Drop hochladen
      handlePaste: (_view, event) => {
        const files = droppedFiles(event)
        if (files.length === 0) return false
        event.preventDefault()
        latest.current.onUpload(files)
        return true
      },
      handleDrop: (_view, event, _slice, moved) => {
        const files = moved ? [] : droppedFiles(event)
        if (files.length === 0) return false
        event.preventDefault()
        latest.current.onUpload(files)
        return true
      },
    },
    onUpdate: ({ editor: e, transaction }) => {
      // Nur echte Änderungen speichern: Plugins normalisieren fremdes HTML (z. B. Absatz nach einer Tabelle) sonst
      // schon beim ersten Klick – das würde eine neue Version erzeugen, ohne dass jemand etwas geschrieben hat
      if (!transaction.docChanged) return
      latest.current.onChange(e.isEmpty ? '' : e.getHTML())
    },
  })

  useImperativeHandle(
    props.handleRef,
    () => ({
      focus: () => editor?.commands.focus(),
      setDoc: (html) => editor?.commands.setContent(html, { emitUpdate: false }),
      insert: (insertion) => {
        if (!editor) return
        // Noch nie in den Text geklickt? Dann ans Ende statt an den Anfang
        const untouched = !editor.isFocused && editor.state.selection.from <= 1 && !editor.isEmpty
        editor.chain().focus(untouched ? 'end' : undefined).insertContent(insertionToHtml(insertion)).run()
      },
      insertAttachment: (att) => editor?.chain().focus().insertContent(attachmentHtml(att)).run(),
      selectedText: () => {
        if (!editor) return ''
        const { from, to } = editor.state.selection
        return editor.state.doc.textBetween(from, to, '\n')
      },
    }),
    [editor],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border">
        {/* Erst mit Editor rendern – sonst zeigt die Leiste bis zur ersten Eingabe nichts an */}
        {editor ? (
          <RichTextToolbar editor={editor} onUpload={props.onUpload} onCreateCard={props.onCreateCard} />
        ) : (
          <div className="h-11" />
        )}
      </div>
      <div className="note-desk min-h-0 flex-1 overflow-y-auto">
        <div className="note-paper">
          <div className="mx-auto w-full max-w-[44rem]">{props.header}</div>
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  )
}
