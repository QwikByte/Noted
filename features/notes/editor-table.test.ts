import { describe, expect, it } from 'vitest'
import { EditorState, Transaction, type TransactionSpec } from '@codemirror/state'
import { history, undo } from '@codemirror/commands'
import type { EditorView } from '@codemirror/view'
import { nextCell, previousCell } from './client/editor/table'

// Die Befehle brauchen vom Editor nur Zustand und dispatch – das geht ohne DOM
function editor(doc: string, cursor: number) {
  const view = {
    state: EditorState.create({ doc, selection: { anchor: cursor }, extensions: [history()] }),
    // Befehle schicken Angaben, undo eine fertige Transaktion
    dispatch: (spec: TransactionSpec | Transaction) => {
      view.state = spec instanceof Transaction ? spec.state : view.state.update(spec).state
    },
  }
  return view as unknown as EditorView
}

const TABLE = '| a | b |\n| --- | --- |\n| 1 | 2 |'

describe('Tab in Tabellen', () => {
  it('springt zur nächsten Zelle und richtet die Tabelle aus', () => {
    const view = editor(TABLE, TABLE.indexOf('1') + 1)
    expect(nextCell(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('| a   | b   |\n| --- | --- |\n| 1   | 2   |')
    const { head } = view.state.selection.main
    expect(view.state.sliceDoc(head - 1, head)).toBe('2')
  })

  it('legt hinter der letzten Zelle eine Zeile an, Umschalt+Tab geht zurück', () => {
    const view = editor(TABLE, TABLE.length - 2)
    nextCell(view)
    expect(view.state.doc.lines).toBe(4)
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(4)
    previousCell(view)
    const { head } = view.state.selection.main
    expect(view.state.sliceDoc(head - 1, head)).toBe('2')
  })

  it('macht eine Tabellenaktion mit einem Schritt rückgängig', () => {
    const view = editor(TABLE, TABLE.length - 2)
    nextCell(view)
    undo(view)
    expect(view.state.doc.toString()).toBe(TABLE)
  })

  it('lässt Tab außerhalb von Tabellen in Ruhe', () => {
    const view = editor('Text\n\n' + TABLE, 2)
    expect(nextCell(view)).toBe(false)
    expect(view.state.doc.toString()).toBe('Text\n\n' + TABLE)
  })
})
