import type { Folder, NoteSummary } from './types'

export type FolderNode = Folder & { children: FolderNode[]; notes: NoteSummary[]; depth: number }

const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' })

export function sortByName<T extends { name?: string; title?: string }>(items: T[]): T[] {
  return items.slice().sort((a, b) => collator.compare(a.name ?? a.title ?? '', b.name ?? b.title ?? ''))
}

export function buildTree(folders: Folder[], notes: NoteSummary[]) {
  const nodes = new Map<string, FolderNode>()
  for (const f of folders) nodes.set(f.id, { ...f, children: [], notes: [], depth: 0 })
  const roots: FolderNode[] = []
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const rootNotes: NoteSummary[] = []
  for (const n of notes) {
    const parent = n.folderId ? nodes.get(n.folderId) : undefined
    if (parent) parent.notes.push(n)
    else rootNotes.push(n)
  }
  const finalize = (list: FolderNode[], depth: number): FolderNode[] =>
    sortByName(list).map((n) => {
      n.depth = depth
      n.children = finalize(n.children, depth + 1)
      n.notes = sortByName(n.notes)
      return n
    })
  return { roots: finalize(roots, 0), rootNotes: sortByName(rootNotes), nodes }
}

/** Pfad eines Ordners, z. B. ["Semester 1", "Analysis"] */
export function folderPath(folders: Folder[], id: string | null): Folder[] {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const path: Folder[] = []
  let current = id ? byId.get(id) : undefined
  let guard = 0
  while (current && guard++ < 64) {
    path.unshift(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return path
}

/** Alle Unterordner-IDs (inkl. des Ordners selbst) */
export function descendantFolderIds(folders: Folder[], id: string): Set<string> {
  const result = new Set([id])
  let changed = true
  while (changed) {
    changed = false
    for (const f of folders) {
      if (f.parentId && result.has(f.parentId) && !result.has(f.id)) {
        result.add(f.id)
        changed = true
      }
    }
  }
  return result
}

/**
 * Dürfen die Notizen bzw. der Ordner in diesen Ordner (`null` = oberste Ebene) verschoben werden? Notizen, sobald
 * mindestens eine noch nicht dort liegt; kein Ordner dorthin, wo er schon liegt, in sich selbst oder einen seiner
 * Unterordner.
 */
export function canMoveTo(
  item: { kind: 'notes'; ids: readonly string[] } | { kind: 'folder'; id: string },
  target: string | null,
  notes: NoteSummary[],
  folders: Folder[],
): boolean {
  if (target !== null && !folders.some((f) => f.id === target)) return false
  if (item.kind === 'notes') {
    const ids = new Set(item.ids)
    return notes.some((n) => ids.has(n.id) && n.folderId !== target)
  }
  const folder = folders.find((f) => f.id === item.id)
  if (!folder || folder.parentId === target) return false
  return target === null || !descendantFolderIds(folders, folder.id).has(target)
}

/** Einfache unscharfe Suche für den Schnellwechsler. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase().trim()
  const t = text.toLowerCase()
  if (!q) return 1
  if (t === q) return 1000
  if (t.startsWith(q)) return 500 - t.length
  const idx = t.indexOf(q)
  if (idx >= 0) return 300 - idx
  // Alle Zeichen der Reihe nach enthalten?
  let pos = 0
  let gaps = 0
  for (const ch of q) {
    const found = t.indexOf(ch, pos)
    if (found < 0) return -1
    gaps += found - pos
    pos = found + 1
  }
  return 100 - gaps
}
