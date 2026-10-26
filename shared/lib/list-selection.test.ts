import { describe, expect, it } from 'vitest'
import { EMPTY_SELECTION, clickSelect, pruneSelection, selectAll, type ListSelection } from './list-selection'

const order = ['a', 'b', 'c', 'd', 'e']
const ids = (sel: ListSelection) => [...sel.ids].sort()

describe('Mehrfachauswahl', () => {
  it('schaltet einzelne Notizen um und merkt sich den Anker', () => {
    const one = clickSelect(EMPTY_SELECTION, order, 'b')
    expect(ids(one)).toEqual(['b'])
    expect(one.anchor).toBe('b')
    const two = clickSelect(one, order, 'd')
    expect(ids(two)).toEqual(['b', 'd'])
    const back = clickSelect(two, order, 'b')
    expect(ids(back)).toEqual(['d'])
    expect(back.anchor).toBe('b')
  })

  it('wählt einen Bereich vorwärts und rückwärts in Anzeigereihenfolge', () => {
    const start = clickSelect(EMPTY_SELECTION, order, 'b')
    expect(ids(clickSelect(start, order, 'd', { range: true }))).toEqual(['b', 'c', 'd'])
    const fromD = clickSelect(EMPTY_SELECTION, order, 'd')
    expect(ids(clickSelect(fromD, order, 'a', { range: true }))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('ersetzt mit einem Bereich die Auswahl oder fügt ihn hinzu', () => {
    let sel = clickSelect(EMPTY_SELECTION, order, 'a')
    sel = clickSelect(sel, order, 'e')
    // Umschalt-Klick: Bereich vom Anker „e“ bis „d“ ersetzt die Auswahl
    expect(ids(clickSelect(sel, order, 'd', { range: true }))).toEqual(['d', 'e'])
    // Strg/⌘+Umschalt-Klick: kommt hinzu
    expect(ids(clickSelect(sel, order, 'c', { range: true, add: true }))).toEqual(['a', 'c', 'd', 'e'])
    // Der Anker bleibt beim Bereich – ein weiterer Umschalt-Klick ändert den Bereich
    const range = clickSelect(sel, order, 'c', { range: true })
    expect(range.anchor).toBe('e')
    expect(ids(clickSelect(range, order, 'd', { range: true }))).toEqual(['d', 'e'])
  })

  it('wählt nur die angeklickte Notiz, wenn der Anker nicht in der Liste liegt', () => {
    const elsewhere = clickSelect(EMPTY_SELECTION, ['x', 'y'], 'x')
    const sel = clickSelect(elsewhere, order, 'c', { range: true })
    expect(ids(sel)).toEqual(['c'])
    expect(sel.anchor).toBe('c')
    expect(ids(clickSelect(elsewhere, order, 'c', { range: true, add: true }))).toEqual(['c', 'x'])
    expect(ids(clickSelect(EMPTY_SELECTION, order, 'b', { range: true }))).toEqual(['b'])
  })

  it('wählt alle Notizen der Liste', () => {
    expect(ids(selectAll(order))).toEqual(order)
    expect(selectAll(order).anchor).toBeNull()
  })

  it('entfernt verschwundene Notizen und den Anker – ohne Änderung bleibt es dasselbe Objekt', () => {
    const sel = clickSelect(clickSelect(EMPTY_SELECTION, order, 'b'), order, 'd')
    expect(pruneSelection(sel, order)).toBe(sel)
    const pruned = pruneSelection(sel, ['a', 'b', 'c'])
    expect(ids(pruned)).toEqual(['b'])
    expect(pruned.anchor).toBeNull()
    const anchorOnly = pruneSelection(clickSelect(sel, order, 'b'), ['a', 'd'])
    expect(ids(anchorOnly)).toEqual(['d'])
    expect(anchorOnly.anchor).toBeNull()
    expect(pruneSelection(EMPTY_SELECTION, [])).toBe(EMPTY_SELECTION)
  })
})
