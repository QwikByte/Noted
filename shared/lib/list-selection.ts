// Mehrfachauswahl in Listen (Notizen, Karteikarten) – reine Logik ohne Browser: Umschalten, Bereich vom Anker und
// Beschneiden, wenn Einträge aus der Liste verschwinden. `order` ist die Reihenfolge, in der die Liste sie anzeigt.

export type ListSelection = {
  ids: ReadonlySet<string>
  /** Zuletzt angeklickter Eintrag – von ihm aus wählt Umschalt-Klick einen Bereich */
  anchor: string | null
}

export const EMPTY_SELECTION: ListSelection = { ids: new Set(), anchor: null }

/**
 * Klick auf einen Eintrag: ohne `range` umschalten, mit `range` den Bereich vom Anker bis hierher wählen (ersetzt die
 * Auswahl, mit `add` kommt er hinzu). Liegt der Anker nicht in `order`, zählt nur der angeklickte Eintrag.
 */
export function clickSelect(
  sel: ListSelection,
  order: readonly string[],
  id: string,
  opts: { range?: boolean; add?: boolean } = {},
): ListSelection {
  if (!opts.range) {
    const ids = new Set(sel.ids)
    if (ids.has(id)) ids.delete(id)
    else ids.add(id)
    return { ids, anchor: id }
  }
  const from = sel.anchor === null ? -1 : order.indexOf(sel.anchor)
  const to = order.indexOf(id)
  if (from < 0 || to < 0) return { ids: new Set(opts.add ? [...sel.ids, id] : [id]), anchor: id }
  const range = order.slice(Math.min(from, to), Math.max(from, to) + 1)
  // Der Anker bleibt: Ein weiterer Umschalt-Klick ändert den Bereich, statt ihn von hier aus fortzusetzen
  return { ids: new Set(opts.add ? [...sel.ids, ...range] : range), anchor: sel.anchor }
}

export function selectAll(order: readonly string[]): ListSelection {
  return { ids: new Set(order), anchor: null }
}

/** Einträge entfernen, die nicht mehr in der Liste stehen – ohne Änderung dasselbe Objekt (kein neues Rendern) */
export function pruneSelection(sel: ListSelection, order: readonly string[]): ListSelection {
  const present = new Set(order)
  const anchorGone = sel.anchor !== null && !present.has(sel.anchor)
  const idsGone = [...sel.ids].some((id) => !present.has(id))
  if (!anchorGone && !idsGone) return sel
  return {
    ids: idsGone ? new Set([...sel.ids].filter((id) => present.has(id))) : sel.ids,
    anchor: anchorGone ? null : sel.anchor,
  }
}
