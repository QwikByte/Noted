'use client'
// Befehle mit „/“ im formatierten Text – ohne eigenes ProseMirror-Plugin: Der Zustand folgt aus der Auswahl, die Tasten
// laufen über handleKeyDown des Editors
import { useState } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import type { EditorState } from '@tiptap/pm/state'
import { filterSlashCommands, matchSlash, type RichSlashCommandId, type SlashEntry } from '../slash-commands'
import { formatDate } from '../templates'
import { pickFiles } from './pick-files'

type Range = { from: number; to: number }

/** „/befehl“ vor dem Cursor – nicht in Code-Blöcken und Inline-Code */
export function richSlashAt(state: EditorState): (Range & { query: string }) | null {
  const { selection } = state
  if (!selection.empty) return null
  const { $from } = selection
  if ($from.parent.type.spec.code || $from.marks().some((m) => m.type.spec.code)) return null
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\n')
  const match = matchSlash(before)
  if (!match) return null
  const from = $from.pos - before.length + match.offset
  if (state.doc.nodeAt(from)?.marks.some((m) => m.type.spec.code)) return null
  return { from, to: $from.pos, query: match.query }
}

type Context = { onUpload: (files: File[]) => void }

// Dieselben Befehle wie in der Werkzeugleiste – „/befehl“ wird im selben Schritt entfernt
const ACTIONS: Record<RichSlashCommandId, (editor: Editor, range: Range, ctx: Context) => void> = {
  h1: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run(),
  h2: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run(),
  h3: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run(),
  bullet: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run(),
  ordered: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run(),
  task: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run(),
  quote: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run(),
  table: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  code: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run(),
  divider: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run(),
  // „Frage“ ist markiert, damit man sie gleich überschreibt
  flashcard: (e, r) =>
    e
      .chain()
      .focus()
      .deleteRange(r)
      .insertContent('Frage::Antwort')
      .setTextSelection({ from: r.from, to: r.from + 5 })
      .run(),
  date: (e, r) => e.chain().focus().deleteRange(r).insertContent(formatDate(new Date(), 'YYYY-MM-DD')).run(),
  // Der Dateidialog muss noch im Tasten- bzw. Klickereignis aufgehen
  file: (e, r, ctx) => {
    e.chain().focus().deleteRange(r).run()
    void pickFiles().then((files) => {
      if (files.length) ctx.onUpload(files)
    })
  },
}

/**
 * Zustand des Menüs: `match` nur, wenn es offen ist (Treffer vorhanden, nicht per Esc geschlossen). `run` fügt den
 * Eintrag ein, `move` wählt mit den Pfeiltasten, `dismiss` schließt das Menü für dieses „/“.
 */
export function useRichSlash(editor: Editor | null, opts: { enabled: boolean; onUpload: (files: File[]) => void }) {
  const current = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const match = e?.isFocused ? richSlashAt(e.state) : null
      return match ? { ...match, inTable: e?.isActive('table') ?? false } : null
    },
  })
  const [selected, setSelected] = useState(0)
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)

  const found = opts.enabled ? current : null
  // Ist kein „/“ mehr da, darf das nächste wieder ein Menü öffnen
  if (!found && dismissedAt !== null) setDismissedAt(null)
  const match = found && found.from !== dismissedAt ? found : null
  const items: SlashEntry[] = match ? filterSlashCommands(match.query, { richText: true, inTable: match.inTable }) : []
  // Neuer Filter: wieder beim ersten Eintrag beginnen
  const filterKey = match ? `${match.from}:${match.query}` : null
  const [prevFilter, setPrevFilter] = useState(filterKey)
  if (filterKey !== prevFilter) {
    setPrevFilter(filterKey)
    setSelected(0)
  }
  const open = !!match && items.length > 0

  return {
    match: open ? match : null,
    items,
    selected: Math.min(selected, Math.max(0, items.length - 1)),
    run: (index: number) => {
      const cmd = items[index]
      if (!editor || !match || !cmd?.richText) return
      ACTIONS[cmd.id](editor, { from: match.from, to: match.to }, { onUpload: opts.onUpload })
    },
    move: (delta: number) => setSelected((s) => (s + delta + items.length) % items.length),
    dismiss: () => {
      if (match) setDismissedAt(match.from)
    },
  }
}
