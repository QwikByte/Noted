// Offline-Speicher für Dateien (Cache des Service Workers): Was kann weg? Dateien, die es nicht mehr gibt – und über
// dem Budget die PDFs, die am längsten nicht geöffnet wurden, außer den als „Offline verfügbar“ markierten.
// Reine Logik; die Cache-API kennt keine Zeitangaben, „zuletzt geöffnet“ führt der Browser selbst.

/** So viel Platz dürfen PDFs belegen, die nicht als „Offline verfügbar“ markiert sind */
export const OFFLINE_BUDGET = 300 * 1024 * 1024

export type CacheEntry = {
  /** Schlüssel im Cache (Adresse) */
  key: string
  /** Die Datei dazu – null, wenn es sie nicht mehr gibt */
  file: { name: string; size: number; pdf: boolean } | null
  /** Zuletzt im Viewer geöffnet (0: unbekannt) */
  opened: number
}

/** Schlüssel der Einträge, die wegkönnen – `pinned`: Dateinamen (klein geschrieben), die offline bleiben */
export function entriesToDelete(entries: CacheEntry[], pinned: ReadonlySet<string>, budget = OFFLINE_BUDGET): string[] {
  const remove = entries.filter((e) => !e.file).map((e) => e.key)
  // Eine Datei kann unter zwei Adressen liegen (Name und ID) – zählt einmal, die Einträge gehen gemeinsam
  const byName = new Map<string, { size: number; opened: number; keys: string[] }>()
  for (const e of entries) {
    if (!e.file?.pdf || pinned.has(e.file.name.toLowerCase())) continue
    const name = e.file.name.toLowerCase()
    const group = byName.get(name) ?? { size: e.file.size, opened: 0, keys: [] }
    group.opened = Math.max(group.opened, e.opened)
    group.keys.push(e.key)
    byName.set(name, group)
  }
  let used = 0
  for (const group of [...byName.values()].sort((a, b) => b.opened - a.opened)) {
    used += group.size
    if (used > budget) remove.push(...group.keys)
  }
  return remove
}
