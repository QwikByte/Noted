import 'server-only'
import { getDb } from '@/shared/server/db'
import { linkKey } from '@/shared/markdown/meta'
import type { GraphData, GraphEdge, GraphNode } from '../types'

/**
 * Alle Notizen eines Nutzers (ohne Papierkorb) mit den Wikilinks zwischen ihnen. Links auf Notizen, die es nicht gibt,
 * fallen weg. Die Ziele werden wie bei „Verlinkt in“ über linkKey(Titel) aufgelöst – in JavaScript statt per SQL
 * lower(), das Umlaute nicht kleinschreibt.
 */
export function getGraph(userId: number): GraphData {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT n.id, n.title, n.folder_id AS folderId,
              (SELECT GROUP_CONCAT(tag, char(31)) FROM note_tags t WHERE t.note_id = n.id) AS tags
       FROM notes n WHERE n.user_id = ? AND n.deleted_at IS NULL
       ORDER BY n.title COLLATE NOCASE, n.id`,
    )
    .all(userId) as { id: string; title: string; folderId: string | null; tags: string | null }[]
  const links = db
    .prepare(
      `SELECT l.note_id AS source, l.target FROM note_links l JOIN notes n ON n.id = l.note_id
       WHERE n.user_id = ? AND n.deleted_at IS NULL ORDER BY l.note_id, l.target`,
    )
    .all(userId) as { source: string; target: string }[]

  // Gleiche Titel in verschiedenen Ordnern: Der Link zählt – wie bei „Verlinkt in“ – für jede dieser Notizen
  const byKey = new Map<string, string[]>()
  for (const r of rows) {
    const key = linkKey(r.title)
    const ids = byKey.get(key)
    if (ids) ids.push(r.id)
    else byKey.set(key, [r.id])
  }
  const edges: GraphEdge[] = []
  const seen = new Set<string>()
  const degree = new Map<string, number>()
  for (const { source, target } of links) {
    for (const id of byKey.get(target) ?? []) {
      const key = `${source}>${id}`
      if (id === source || seen.has(key)) continue
      seen.add(key)
      edges.push({ source, target: id })
      degree.set(source, (degree.get(source) ?? 0) + 1)
      degree.set(id, (degree.get(id) ?? 0) + 1)
    }
  }
  const nodes: GraphNode[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    folderId: r.folderId,
    tags: r.tags ? r.tags.split('\u001f').sort() : [],
    links: degree.get(r.id) ?? 0,
  }))
  return { nodes, edges }
}
