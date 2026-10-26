'use client'
// Mehrfachauswahl in einer Liste (Notizen, Karteikarten): Zustand und Tastatur (Strg/⌘+A, Esc)
import { useEffect, useRef, useState } from 'react'
import { EMPTY_SELECTION, clickSelect, pruneSelection, selectAll, type ListSelection } from '@/shared/lib/list-selection'

type Modifiers = { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }

export type ListSelectionState = {
  ids: ReadonlySet<string>
  /** Auswahlmodus: Checkboxen sind sichtbar, Klick oder Tippen auf einen Eintrag wählt ihn aus statt ihn zu öffnen */
  active: boolean
  /** Alle auswählbaren Einträge der Ansicht in Anzeigereihenfolge */
  order: readonly string[]
  start: () => void
  stop: () => void
  /** Klick auf einen Eintrag – `listOrder`: die Liste, in der er steht (Umschalt-Klick wählt nur darin einen Bereich) */
  click: (id: string, listOrder: readonly string[], mods: Modifiers) => void
  selectAll: () => void
}

/** Hier bleibt Strg/⌘+A beim Browser (Text markieren), und Esc gehört dem Feld, Dialog oder Menü */
const OWN_KEYS = 'input, textarea, select, [contenteditable="true"], dialog[open], [role="menu"]'

/**
 * Auswahl einer Ansicht. Ändert sich `resetKey` (anderer Ordner, Tag, Suchbegriff, Filter), ist sie aufgehoben;
 * Einträge, die aus `order` verschwinden, fallen heraus. Strg/⌘+A wirkt nur, wenn der Fokus auf der Seite, im
 * Hauptbereich selbst oder in `root` liegt – nicht im PDF daneben.
 */
export function useListSelection({
  order,
  resetKey,
  root,
}: {
  order: readonly string[]
  resetKey: string
  root: React.RefObject<HTMLElement | null>
}): ListSelectionState {
  const [selection, setSelection] = useState<ListSelection>(EMPTY_SELECTION)
  const [active, setActive] = useState(false)

  const [prevKey, setPrevKey] = useState(resetKey)
  if (prevKey !== resetKey) {
    setPrevKey(resetKey)
    setSelection(EMPTY_SELECTION)
    setActive(false)
  }
  const pruned = pruneSelection(selection, order)
  if (pruned !== selection) setSelection(pruned)

  const latest = useRef({ order, active })
  useEffect(() => {
    latest.current = { order, active }
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof HTMLElement ? e.target : null
      if (!t || e.defaultPrevented || t.closest(OWN_KEYS)) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a') {
        const { order } = latest.current
        const here = t === document.body || t.id === 'main' || !!root.current?.contains(t)
        if (!here || order.length === 0) return
        e.preventDefault()
        setSelection(selectAll(order))
        setActive(true)
      } else if (e.key === 'Escape' && latest.current.active) {
        // Erst schließt Esc offene Menüs und Dialoge bzw. bricht das Ziehen ab – die Auswahl danach
        if (document.querySelector('dialog[open], [role="menu"]')) return
        if (document.documentElement.classList.contains('dragging')) return
        setSelection(EMPTY_SELECTION)
        setActive(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [root])

  return {
    ids: pruned.ids,
    active,
    order,
    start: () => setActive(true),
    stop: () => {
      setSelection(EMPTY_SELECTION)
      setActive(false)
    },
    click: (id, listOrder, mods) => {
      setSelection((sel) => clickSelect(sel, listOrder, id, { range: mods.shiftKey, add: mods.ctrlKey || mods.metaKey }))
      setActive(true)
    },
    selectAll: () => {
      setSelection(selectAll(order))
      setActive(true)
    },
  }
}
