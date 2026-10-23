import { describe, expect, it } from 'vitest'
import { EditorState, type TransactionSpec } from '@codemirror/state'
import { history, undo } from '@codemirror/commands'
import { docReplacement } from './client/editor/replace'
import { externalChange } from './client/editor/setup'

function editor(doc: string, cursor = 0) {
  let state = EditorState.create({ doc, selection: { anchor: cursor }, extensions: [history()] })
  const apply = (spec: TransactionSpec) => {
    const tr = state.update(spec)
    state = tr.state
    return tr
  }
  return {
    get state() {
      return state
    },
    apply,
    type: (at: number, text: string) => apply({ changes: { from: at, insert: text }, userEvent: 'input.type' }),
    undo: () => undo({ state, dispatch: (tr) => (state = tr.state) }),
  }
}

describe('Inhalt im Editor ersetzen', () => {
  it('Strg+Z holt einen Stand vom anderen Gerät nicht zurück', () => {
    const e = editor('Vorlesung 5\n\nAbsatz eins')
    e.apply(docReplacement(e.state.doc, 'Vorlesung 5\n\nAbsatz eins\n\nVom Handy', false))
    e.type(0, '# ')
    expect(e.undo()).toBe(true)
    expect(e.state.doc.toString()).toBe('Vorlesung 5\n\nAbsatz eins\n\nVom Handy')
    // Nichts mehr rückgängig zu machen – vorher stellte der zweite Schritt den alten Text wieder her
    e.undo()
    expect(e.state.doc.toString()).toBe('Vorlesung 5\n\nAbsatz eins\n\nVom Handy')
  })

  it('frühere eigene Eingaben bleiben an ihrer Stelle rückgängig zu machen', () => {
    const e = editor('eins\nzwei')
    e.type(0, 'X')
    e.apply(docReplacement(e.state.doc, 'Xeins\nzwei\ndrei', false))
    e.undo()
    expect(e.state.doc.toString()).toBe('eins\nzwei\ndrei')
  })

  it('ersetzt nur den geänderten Bereich – der Cursor bleibt, wo er war', () => {
    const e = editor('abc def ghi', 2)
    const tr = e.apply(docReplacement(e.state.doc, 'abc def GHI!', false))
    const changed: [number, number, string][] = []
    tr.changes.iterChanges((from, to, _f, _t, inserted) => changed.push([from, to, inserted.toString()]))
    expect(changed).toEqual([[8, 11, 'GHI!']])
    expect(e.state.selection.main.head).toBe(2)
    expect(tr.annotation(externalChange)).toBe(true)
  })

  it('bleibt rückgängig zu machen, wenn es eine eigene Aktion ist (Aufgabe abgehakt)', () => {
    const e = editor('- [ ] Blatt 3')
    e.apply(docReplacement(e.state.doc, '- [x] Blatt 3', true))
    expect(e.state.doc.toString()).toBe('- [x] Blatt 3')
    e.undo()
    expect(e.state.doc.toString()).toBe('- [ ] Blatt 3')
  })

  it('kommt mit gleichem und leerem Inhalt zurecht', () => {
    const e = editor('gleich')
    expect(e.apply(docReplacement(e.state.doc, 'gleich', false)).docChanged).toBe(false)
    e.apply(docReplacement(e.state.doc, '', false))
    expect(e.state.doc.toString()).toBe('')
    e.apply(docReplacement(e.state.doc, 'aaa', false))
    e.apply(docReplacement(e.state.doc, 'aa', false))
    expect(e.state.doc.toString()).toBe('aa')
  })
})
