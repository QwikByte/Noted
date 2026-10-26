'use client'
// Fundstellen aus der Volltextsuche im Editor markieren – bis zur ersten Eingabe oder bis die Leiste geschlossen wird
import { StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import type { TextMatch } from '../../search-match'

const setHits = StateEffect.define<{ hits: TextMatch[]; current: number } | null>()

const hit = Decoration.mark({ class: 'cm-search-hit' })
const currentHit = Decoration.mark({ class: 'cm-search-hit cm-search-hit-current' })

const hitsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (!e.is(setHits)) continue
      if (!e.value) return Decoration.none
      const { hits, current } = e.value
      return Decoration.set(
        hits.map((h, i) => (i === current ? currentHit : hit).range(h.from, h.to)),
        true,
      )
    }
    if (tr.isUserEvent('input') || tr.isUserEvent('delete')) return Decoration.none
    return deco.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f),
})

const theme = EditorView.theme({
  '.cm-search-hit': { backgroundColor: 'var(--mark)', borderRadius: '2px' },
  '.cm-search-hit-current': { backgroundColor: 'var(--mark-current)' },
})

export const searchHits = (): Extension => [hitsField, theme]

/** Fundstellen markieren und den Cursor an den Anfang der aktuellen setzen (keine Auswahl: Tippen ersetzt nichts) */
export function showSearchHits(view: EditorView, hits: TextMatch[], current: number) {
  const at = hits[current]
  view.dispatch({
    effects: [setHits.of({ hits, current }), ...(at ? [EditorView.scrollIntoView(at.from, { y: 'center' })] : [])],
    selection: at ? { anchor: at.from } : undefined,
  })
}

export function clearSearchHits(view: EditorView) {
  if (view.state.field(hitsField, false)?.size) view.dispatch({ effects: setHits.of(null) })
}
