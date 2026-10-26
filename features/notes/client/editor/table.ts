'use client'
// Tabellen im Markdown-Editor: Tab springt zur nächsten Zelle und richtet die Tabelle dabei aus, das Kontextmenü fügt
// Zeilen und Spalten ein oder löscht sie. Jede Aktion ist ein Schritt für Rückgängig.
import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { cellAt, cellEnd, formatTable, moveCell, parseTableAt, type Cell, type Table } from '../../markdown-table'

type Found = { table: Table; cell: Cell }

/** Tabelle und Zelle an `pos` – null außerhalb einer Tabelle */
export function tableAt(state: EditorState, pos: number): Found | null {
  const { doc } = state
  const line = doc.lineAt(pos)
  const table = parseTableAt((i) => (i >= 0 && i < doc.lines ? doc.line(i + 1).text : undefined), line.number - 1)
  return table ? { table, cell: cellAt(table, line.number - 1, pos - line.from, line.text) } : null
}

/** Geänderte Tabelle ausgerichtet einsetzen und den Cursor hinter den Inhalt der Zelle setzen */
export function applyTable(view: EditorView, before: Table, { table, cell }: Found) {
  const { doc } = view.state
  const from = doc.line(before.from + 1).from
  const to = doc.line(before.to + 1).to
  const text = formatTable(table)
  const target = cellEnd(table, cell)
  const lines = text.split('\n')
  let anchor = from + target.ch
  for (let i = 0; i < target.line; i++) anchor += lines[i].length + 1
  const unchanged = doc.sliceString(from, to) === text
  view.dispatch({
    changes: unchanged ? undefined : { from, to, insert: text },
    selection: { anchor },
    scrollIntoView: true,
    userEvent: 'input.table',
  })
}

function move(view: EditorView, step: 1 | -1): boolean {
  const found = tableAt(view.state, view.state.selection.main.head)
  if (!found) return false
  applyTable(view, found.table, moveCell(found.table, found.cell, step))
  return true
}

/** Tab in einer Tabelle: nächste Zelle, hinter der letzten eine neue Zeile – außerhalb nichts (dann rückt Tab ein) */
export const nextCell = (view: EditorView) => move(view, 1)
export const previousCell = (view: EditorView) => move(view, -1)
