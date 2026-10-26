// Titel → Notizen, um [[Links]] im Browser aufzulösen. Tresor-Notizen getrennt: Nur Links aus dem Tresor finden sie
// (dort gehen sie bei Namensgleichheit vor). Beim Tippen ändert sich an der Notizliste nur Auszug und Bearbeitungszeit
// – dann bleibt der Index derselbe, und was von ihm abhängt (Links in der Vorschau), muss nicht neu rendern.
import { linkKey } from '@/shared/markdown/meta'

type Indexed = { id: string; title: string; folderId: string | null; vault: boolean }

export type TitleIndex<T extends Indexed> = { plain: Map<string, T[]>; inVault: Map<string, T[]> }

/** Alles, wovon der Index abhängt – Notizen in der Liste, ihre Titel, Ordner und die Zugehörigkeit zum Tresor */
export function titleSignature(notes: Indexed[]): string {
  return notes.map((n) => `${n.id}\u0000${n.title}\u0000${n.folderId ?? ''}\u0000${n.vault ? 1 : 0}`).join('\u0001')
}

function buildTitleIndex<T extends Indexed>(notes: T[]): TitleIndex<T> {
  const plain = new Map<string, T[]>()
  const inVault = new Map<string, T[]>()
  for (const n of notes) {
    const index = n.vault ? inVault : plain
    const key = linkKey(n.title)
    const list = index.get(key)
    if (list) list.push(n)
    else index.set(key, [n])
  }
  return { plain, inVault }
}

/** Index mit Gedächtnis: Bei gleicher Signatur kommt derselbe Index zurück */
export function createTitleIndexer<T extends Indexed>() {
  let last: { signature: string; index: TitleIndex<T> } | null = null
  return (notes: T[]): TitleIndex<T> => {
    const signature = titleSignature(notes)
    if (last?.signature !== signature) last = { signature, index: buildTitleIndex(notes) }
    return last.index
  }
}

/**
 * Gleichnamige Notizen, die zuletzt bearbeitete zuerst – erst beim Auflösen entschieden, weil der Index beim Tippen
 * nicht neu entsteht. `updatedAt` liefert die aktuelle Bearbeitungszeit.
 */
export function newestFirst<T extends { id: string }>(list: T[], updatedAt: (id: string) => number): T[] {
  return list.length < 2 ? list : [...list].sort((a, b) => updatedAt(b.id) - updatedAt(a.id))
}
