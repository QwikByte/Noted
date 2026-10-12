'use client'
// Formatierungsbefehle für die Editor-Toolbar
import { EditorSelection, type ChangeSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

/** Auswahl mit Zeichen umschließen (oder wieder entfernen). */
export function wrapSelection(view: EditorView, before: string, after = before, placeholder = '') {
  const { state } = view
  const tr = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to)
    const outerFrom = range.from - before.length
    const outerTo = range.to + after.length
    // Bereits umschlossen → entfernen
    if (
      outerFrom >= 0 &&
      state.sliceDoc(outerFrom, range.from) === before &&
      state.sliceDoc(range.to, outerTo) === after
    ) {
      return {
        changes: [
          { from: outerFrom, to: range.from, insert: '' },
          { from: range.to, to: outerTo, insert: '' },
        ],
        range: EditorSelection.range(outerFrom, range.to - before.length),
      }
    }
    const inner = text || placeholder
    return {
      changes: { from: range.from, to: range.to, insert: before + inner + after },
      range: EditorSelection.range(range.from + before.length, range.from + before.length + inner.length),
    }
  })
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input' }))
  view.focus()
}

const LINE_PREFIX_RE = /^(\s*)(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)?/

/** Präfix für alle ausgewählten Zeilen setzen/entfernen (Listen, Zitate, Überschriften). */
export function toggleLinePrefix(view: EditorView, prefix: string | ((i: number) => string)) {
  const { state } = view
  const lines = new Set<number>()
  for (const r of state.selection.ranges) {
    for (let l = state.doc.lineAt(r.from).number; l <= state.doc.lineAt(r.to).number; l++) lines.add(l)
  }
  const sorted = [...lines].sort((a, b) => a - b)
  const first = typeof prefix === 'string' ? prefix : prefix(0)
  const allHave = sorted.every((n) => {
    const text = state.doc.line(n).text
    const m = LINE_PREFIX_RE.exec(text)
    const existing = m?.[2] ?? ''
    return typeof prefix === 'string' ? existing === prefix : /^\d+[.)]\s+$/.test(existing) === /^\d/.test(first)
  })
  const changes: ChangeSpec[] = []
  sorted.forEach((n, i) => {
    const line = state.doc.line(n)
    const m = LINE_PREFIX_RE.exec(line.text)!
    const indent = m[1]
    const existing = m[2] ?? ''
    const from = line.from + indent.length
    const to = from + existing.length
    const p = typeof prefix === 'string' ? prefix : prefix(i)
    changes.push({ from, to, insert: allHave && existing ? '' : p })
  })
  view.dispatch({ changes, userEvent: 'input', scrollIntoView: true })
  view.focus()
}

export function setHeading(view: EditorView, level: number) {
  const { state } = view
  const line = state.doc.lineAt(state.selection.main.head)
  const m = /^(#{1,6})\s+/.exec(line.text)
  const current = m ? m[1].length : 0
  const prefix = current === level ? '' : '#'.repeat(level) + ' '
  view.dispatch({
    changes: { from: line.from, to: line.from + (m ? m[0].length : 0), insert: prefix },
    userEvent: 'input',
  })
  view.focus()
}

/** Text an der Cursorposition einfügen; `cursor` = Position des Cursors innerhalb des Texts. */
export function insertText(view: EditorView, text: string, cursor = text.length, selectLength = 0) {
  const { state } = view
  const range = state.selection.main
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: text },
    selection: EditorSelection.range(range.from + cursor, range.from + cursor + selectLength),
    scrollIntoView: true,
    userEvent: 'input',
  })
  view.focus()
}

/** Block (z. B. Tabelle, Callout) in eigenen Zeilen einfügen. */
export function insertBlock(view: EditorView, block: string, cursorInBlock?: number) {
  const { state } = view
  const range = state.selection.main
  const line = state.doc.lineAt(range.from)
  const atLineStart = range.from === line.from
  const needsNewlineBefore = !atLineStart || (line.number > 1 && line.text.trim() !== '' && range.from !== line.from)
  const before = needsNewlineBefore ? (line.text.trim() ? '\n\n' : '\n') : ''
  const prevLine = line.number > 1 ? state.doc.line(line.number - 1).text : ''
  const spacer = !before && atLineStart && prevLine.trim() !== '' ? '\n' : ''
  const text = spacer + before + block + '\n'
  const cursor = spacer.length + before.length + (cursorInBlock ?? block.length)
  insertText(view, text, cursor)
}

export function insertCallout(view: EditorView, type: string, title = '') {
  const { state } = view
  const sel = state.sliceDoc(state.selection.main.from, state.selection.main.to)
  const body = sel ? sel.split('\n').map((l) => `> ${l}`).join('\n') : '> '
  const head = `> [!${type}]${title ? ' ' + title : ''}\n`
  insertBlock(view, head + body, head.length + body.length)
}

export function insertTable(view: EditorView) {
  const table = '| Spalte 1 | Spalte 2 |\n| --- | --- |\n|  |  |'
  insertBlock(view, table, table.indexOf('|  |') + 2)
}

export function insertLink(view: EditorView) {
  const { state } = view
  const sel = state.sliceDoc(state.selection.main.from, state.selection.main.to)
  if (sel) wrapSelection(view, '[[', ']]')
  else insertText(view, '[[]]', 2)
}

export function insertMath(view: EditorView, block: boolean) {
  if (block) insertBlock(view, '$$\n\n$$', 3)
  else wrapSelection(view, '$', '$', 'x^2')
}

export function insertCodeBlock(view: EditorView) {
  const { state } = view
  const sel = state.sliceDoc(state.selection.main.from, state.selection.main.to)
  if (sel && !sel.includes('\n')) return wrapSelection(view, '`')
  insertBlock(view, '```\n' + sel + '\n```', 3)
}
