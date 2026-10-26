'use client'
// Editor für formatierten Text. Wird per next/dynamic nachgeladen (TipTap ist groß) und gibt der Notizansicht
// dieselbe Schnittstelle wie der Markdown-Editor.
import { useEffect, useImperativeHandle, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { richTextExtensions } from '../client/rich-text'
import { useRichSlash } from '../client/rich-slash'
import { attachmentHtml, insertionToHtml } from '../rich-html'
import { RichTextToolbar } from './RichTextToolbar'
import { EditMenuItems } from './EditorMenuItems'
import { SlashMenu } from './SlashMenu'
import { Bold, Italic, Layers, Strikethrough, Underline } from 'lucide-react'
import { MenuItem, MenuSeparator, useContextMenu } from '@/shared/ui/menu'
import type { RichTextHandle } from '../client/editor-handle'

type Props = {
  handleRef: React.Ref<RichTextHandle>
  initialHtml: string
  onChange: (html: string) => void
  onSave: () => void
  onUpload: (files: File[]) => void
  onCreateCard: () => void
  autoFocus?: boolean
  spellcheck?: boolean
  /** Sprache des Textes (BCP-47) – wirkt sofort */
  lang?: string
  /** Menü mit Befehlen nach „/“ */
  slashCommands?: boolean
  /** Über dem Text, z. B. das Titelfeld */
  header: React.ReactNode
}

function droppedFiles(event: ClipboardEvent | DragEvent): File[] {
  const list = 'clipboardData' in event ? event.clipboardData?.files : event.dataTransfer?.files
  return Array.from(list ?? [])
}

const attributes = (props: Props) => ({
  class: 'markdown-body rich-text',
  'aria-label': 'Notiztext',
  'aria-multiline': 'true',
  spellcheck: String(props.spellcheck !== false),
  lang: props.lang ?? 'de',
  'data-testid': 'rich-editor',
})

export default function RichTextEditor(props: Props) {
  const latest = useRef(props)
  useEffect(() => {
    latest.current = props
  })
  // Zustand des Menüs „/“ für handleKeyDown – der Editor wird nur einmal angelegt
  const slashRef = useRef<ReturnType<typeof useRichSlash> | null>(null)

  const editor = useEditor({
    extensions: richTextExtensions({ placeholder: 'Schreib los …' }),
    content: props.initialHtml,
    immediatelyRender: false,
    autofocus: props.autoFocus ? 'end' : false,
    editorProps: {
      attributes: attributes(props),
      handleKeyDown: (_view, event) => {
        // Offenes Menü „/“: Pfeiltasten wählen, Enter fügt ein, Esc schließt – Tab rückt weiter ein
        const slash = slashRef.current
        if (slash?.match && !event.isComposing) {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            slash.move(event.key === 'ArrowDown' ? 1 : -1)
            return true
          }
          if (event.key === 'Enter') {
            slash.run(slash.selected)
            return true
          }
          if (event.key === 'Escape') {
            slash.dismiss()
            return true
          }
        }
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

  // Andere Standardsprache in den Einstellungen: ohne neuen Editor übernehmen
  const { lang } = props
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.setOptions({ editorProps: { ...editor.options.editorProps, attributes: attributes(latest.current) } })
  }, [editor, lang])

  const slash = useRichSlash(editor, { enabled: props.slashCommands !== false, onUpload: props.onUpload })
  useEffect(() => {
    slashRef.current = slash
  })

  const openContextMenu = useContextMenu()
  // Rechtsklick in den Text: Bearbeiten und Formatieren wie in der Werkzeugleiste
  function onContextMenu(e: React.MouseEvent) {
    if (!editor) return
    const chain = () => editor.chain().focus()
    const hasSelection = !editor.state.selection.empty
    openContextMenu(
      e,
      <>
        <EditMenuItems
          target={{
            focus: () => editor.commands.focus(),
            hasSelection,
            // Wie Strg+V: ProseMirror wandelt den Text dabei in Absätze um
            paste: (text) => {
              editor.commands.focus()
              editor.view.pasteText(text)
            },
            selectAll: () => chain().selectAll().run(),
            undo: () => chain().undo().run(),
            redo: () => chain().redo().run(),
          }}
        />
        <MenuSeparator />
        <MenuItem icon={<Bold />} onSelect={() => chain().toggleBold().run()} hint="Strg+B">
          Fett
        </MenuItem>
        <MenuItem icon={<Italic />} onSelect={() => chain().toggleItalic().run()} hint="Strg+I">
          Kursiv
        </MenuItem>
        <MenuItem icon={<Underline />} onSelect={() => chain().toggleUnderline().run()} hint="Strg+U">
          Unterstrichen
        </MenuItem>
        <MenuItem icon={<Strikethrough />} onSelect={() => chain().toggleStrike().run()}>
          Durchgestrichen
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<Layers />} onSelect={props.onCreateCard}>
          {hasSelection ? 'Karteikarte aus Markierung' : 'Karteikarte erstellen'}
        </MenuItem>
      </>,
      { text: true },
    )
  }

  useImperativeHandle(
    props.handleRef,
    () => ({
      focus: () => editor?.commands.focus(),
      // Nicht in den Verlauf: Rückgängig holte sonst den Stand von vor dem Austausch zurück und speicherte ihn
      setDoc: (html) => editor?.chain().setMeta('addToHistory', false).setContent(html, { emitUpdate: false }).run(),
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
      revealHeading: (index, focus) => {
        if (!editor) return
        let n = 0
        let target = -1
        editor.state.doc.descendants((node, pos) => {
          if (target >= 0) return false
          if (node.type.name !== 'heading') return true
          if (n++ === index) target = pos
          return false
        })
        if (target < 0) return
        editor.commands.setTextSelection(target + 1)
        const dom = editor.view.nodeDOM(target)
        if (dom instanceof HTMLElement) dom.scrollIntoView({ block: 'start' })
        if (focus) editor.commands.focus(undefined, { scrollIntoView: false })
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
        <div className="note-paper" onContextMenu={onContextMenu}>
          <div className="mx-auto w-full max-w-[44rem]">{props.header}</div>
          <EditorContent editor={editor} />
        </div>
      </div>
      {editor && slash.match ? (
        <SlashMenu editor={editor} from={slash.match.from} items={slash.items} selected={slash.selected} onPick={slash.run} />
      ) : null}
    </div>
  )
}
