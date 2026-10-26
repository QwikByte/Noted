'use client'
// Abschnitte unter Überschriften einklappen: ein Knopf vor jeder Überschrift, Tastenkürzel und Befehle für das
// Kontextmenü. Den Abschnitt bis zur nächsten Überschrift gleicher oder höherer Ebene liefert der Faltdienst von
// @codemirror/lang-markdown. Eingeklappt ist nur für die Sitzung – der Inhalt der Notiz ändert sich nicht.
import { EditorState, RangeSetBuilder, type Extension, type Line, type StateEffect } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import {
  codeFolding,
  ensureSyntaxTree,
  foldable,
  foldedRanges,
  foldEffect,
  syntaxTree,
  unfoldAll,
  unfoldEffect,
} from '@codemirror/language'

type Range = { from: number; to: number }

const HEADING_RE = /^(?:ATX|Setext)Heading\d$/

/** Beginnt in dieser Zeile eine Überschrift (außerhalb von Code und Frontmatter)? */
function isHeadingLine(state: EditorState, line: Line): boolean {
  let found = false
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter: (node) => {
      if (found) return false
      // Eine Setext-Überschrift gehört zu ihrer ersten Zeile, nicht zur Unterstreichung
      if (HEADING_RE.test(node.name)) {
        found = node.from >= line.from
        return false
      }
    },
  })
  return found
}

/** Abschnitt unter der Überschrift in dieser Zeile – null ohne Überschrift oder ohne Inhalt darunter */
function headingSection(state: EditorState, line: Line): Range | null {
  return isHeadingLine(state, line) ? foldable(state, line.from, line.to) : null
}

/** Eingeklappter Abschnitt, der am Ende dieser Zeile beginnt */
function foldAt(state: EditorState, line: Line): Range | null {
  let found: Range | null = null
  foldedRanges(state).between(line.to, line.to, (from, to) => {
    if (from === line.to) found = { from, to }
  })
  return found
}

/** Überschrift, zu deren Abschnitt `pos` gehört: die eigene Zeile oder die nächste Überschrift darüber */
function headingAround(state: EditorState, pos: number): Line | null {
  for (let n = state.doc.lineAt(pos).number; n >= 1; n--) {
    const line = state.doc.line(n)
    if (isHeadingLine(state, line)) return line
  }
  return null
}

function announce(view: EditorView, range: Range, folded: boolean): StateEffect<string> {
  const from = view.state.doc.lineAt(range.from).number
  const to = view.state.doc.lineAt(range.to).number
  return EditorView.announce.of(`${folded ? 'Eingeklappt' : 'Aufgeklappt'}: Zeilen ${from} bis ${to}.`)
}

function setFolded(view: EditorView, line: Line, fold: boolean): boolean {
  const current = foldAt(view.state, line)
  if (!fold) {
    if (!current) return false
    view.dispatch({ effects: [unfoldEffect.of(current), announce(view, current, false)] })
    return true
  }
  const range = current ? null : headingSection(view.state, line)
  if (!range) return false
  view.dispatch({ effects: [foldEffect.of(range), announce(view, range, true)] })
  return true
}

/** Abschnitt, zu dem `pos` gehört, und ob er eingeklappt ist – null außerhalb von Abschnitten (z. B. für das Kontextmenü) */
export function sectionAt(state: EditorState, pos: number): { line: Line; range: Range; folded: boolean } | null {
  const line = headingAround(state, pos)
  if (!line) return null
  const folded = foldAt(state, line)
  const range = folded ?? headingSection(state, line)
  return range ? { line, range, folded: !!folded } : null
}

/** Abschnitt an `pos` (Standard: Cursor) ein- bzw. aufklappen */
export function foldSection(view: EditorView, fold = true, pos = view.state.selection.main.head): boolean {
  const line = headingAround(view.state, pos)
  return !!line && setFolded(view, line, fold)
}

const unfoldSection = (view: EditorView) => foldSection(view, false)

/** Alle Abschnitte einklappen – die äußeren; was darin liegt, verschwindet mit */
export function foldAllSections(view: EditorView): boolean {
  const { state } = view
  const tree = ensureSyntaxTree(state, state.doc.length, 500) ?? syntaxTree(state)
  const effects: StateEffect<Range>[] = []
  let skipTo = -1
  tree.iterate({
    enter: (node) => {
      if (!HEADING_RE.test(node.name) || node.from < skipTo) return
      const line = state.doc.lineAt(node.from)
      const range = foldAt(state, line) ?? foldable(state, line.from, line.to)
      if (!range) return false
      if (!foldAt(state, line)) effects.push(foldEffect.of(range))
      skipTo = range.to
      return false
    },
  })
  if (effects.length) view.dispatch({ effects })
  return effects.length > 0
}

export { unfoldAll as unfoldAllSections }

// Dieselbe Erkennung wie CodeMirror für AltGr (browser.windows)
const isWindows = () => /Win/.test(navigator.platform)

const CHEVRON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'

class FoldMarker extends WidgetType {
  constructor(readonly folded: boolean) {
    super()
  }

  eq(other: FoldMarker) {
    return other.folded === this.folded
  }

  toDOM(view: EditorView) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cm-fold-marker'
    const label = this.folded ? 'Abschnitt aufklappen' : 'Abschnitt einklappen'
    button.setAttribute('aria-label', label)
    button.setAttribute('aria-expanded', String(!this.folded))
    button.title = label
    button.innerHTML = CHEVRON
    // Cursor und Fokus bleiben, wo sie sind
    button.addEventListener('mousedown', (e) => e.preventDefault())
    button.addEventListener('click', (e) => {
      e.preventDefault()
      const line = view.state.doc.lineAt(view.posAtDOM(button))
      setFolded(view, line, !foldAt(view.state, line))
    })
    return button
  }

  ignoreEvent() {
    return true
  }
}

const OPEN = Decoration.widget({ widget: new FoldMarker(false), side: -1 })
const CLOSED = Decoration.widget({ widget: new FoldMarker(true), side: -1 })

function markers(view: EditorView): DecorationSet {
  const { state } = view
  const builder = new RangeSetBuilder<Decoration>()
  let last = -1
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (!HEADING_RE.test(node.name)) return
        const line = state.doc.lineAt(node.from)
        if (line.from > last) {
          if (foldAt(state, line)) builder.add(line.from, line.from, CLOSED)
          else if (foldable(state, line.from, line.to)) builder.add(line.from, line.from, OPEN)
          last = line.from
        }
        return false
      },
    })
  }
  return builder.finish()
}

const markerPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = markers(view)
    }
    update(u: ViewUpdate) {
      const folds = foldedRanges(u.startState) !== foldedRanges(u.state)
      if (u.docChanged || u.viewportChanged || folds || syntaxTree(u.startState) !== syntaxTree(u.state)) {
        this.decorations = markers(u.view)
      }
    }
  },
  { decorations: (p) => p.decorations },
)

/**
 * Änderungen an einer eingeklappten Überschrift oder ihrem Abschnitt klappen ihn auf: Der Abschnitt könnte sich gerade
 * ändern – und wer rechts neben „…“ klickt, steht mit dem Cursor am Ende des versteckten Texts und sähe sonst nicht,
 * wohin er tippt
 */
const unfoldEditedSections = EditorState.transactionExtender.of((tr) => {
  if (!tr.docChanged) return null
  const effects: StateEffect<Range>[] = []
  const { doc } = tr.startState
  foldedRanges(tr.startState).between(0, doc.length, (from, to) => {
    const lineStart = doc.lineAt(from).from
    let touched = false
    tr.changes.iterChangedRanges((fromA, toA) => {
      if (fromA <= to && toA >= lineStart) touched = true
    })
    // Positionen im neuen Text, so wie der Faltzustand seine Bereiche selbst verschiebt
    if (touched) effects.push(unfoldEffect.of({ from: tr.changes.mapPos(from, 1), to: tr.changes.mapPos(to, -1) }))
  })
  return effects.length ? { effects } : null
})

const theme = EditorView.theme({
  '.cm-fold-marker': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    // Im Innenabstand der Zeile: Das Blatt sieht ohne eingeklappte Abschnitte aus wie vorher
    width: '20px',
    height: '24px',
    marginLeft: '-20px',
    verticalAlign: 'middle',
    padding: '0',
    border: 'none',
    borderRadius: '4px',
    background: 'none',
    color: 'var(--text-faint)',
    cursor: 'pointer',
    opacity: '0',
    transition: 'opacity 120ms, transform 120ms',
  },
  '.cm-fold-marker[aria-expanded="false"] svg': { transform: 'rotate(-90deg)' },
  '.cm-fold-marker:hover': { color: 'var(--text)', backgroundColor: 'var(--bg-hover)' },
  '.cm-line:hover .cm-fold-marker, .cm-fold-marker[aria-expanded="false"], .cm-fold-marker:focus-visible': {
    opacity: '1',
  },
  '.cm-foldPlaceholder': {
    margin: '0 4px',
    padding: '0 6px',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    backgroundColor: 'var(--bg-subtle)',
    color: 'var(--text-muted)',
    cursor: 'pointer',
  },
  // Auf Touch-Geräten gibt es kein Überfahren
  '@media (pointer: coarse)': { '.cm-fold-marker': { opacity: '1' } },
  '@media (prefers-reduced-motion: reduce)': { '.cm-fold-marker': { transition: 'none' } },
})

/** Einklappen für den Markdown-Editor */
export function sectionFolding(): Extension {
  return [
    codeFolding({
      placeholderDOM: (_view, onclick) => {
        const el = document.createElement('span')
        el.className = 'cm-foldPlaceholder'
        el.textContent = '…'
        el.title = 'Aufklappen'
        el.setAttribute('aria-label', 'Eingeklappter Abschnitt, zum Aufklappen klicken')
        el.onclick = onclick
        return el
      },
    }),
    markerPlugin,
    unfoldEditedSections,
    theme,
    // Wie die Kürzel von CodeMirror (foldKeymap), aber für den Abschnitt am Cursor statt nur für Absätze und Code.
    // Unter Windows ist AltGr zugleich Strg+Alt: Auf deutschen Tastaturen tippt AltGr+8 ein „[“ – dort bleibt es dabei
    keymap.of([
      { key: 'Ctrl-Shift-[', mac: 'Cmd-Alt-[', run: (v) => foldSection(v) },
      { key: 'Ctrl-Shift-]', mac: 'Cmd-Alt-]', run: unfoldSection },
      { key: 'Ctrl-Alt-[', run: (v) => !isWindows() && foldAllSections(v) },
      { key: 'Ctrl-Alt-]', run: (v) => !isWindows() && unfoldAll(v) },
    ]),
  ]
}
