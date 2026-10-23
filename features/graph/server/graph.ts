import 'server-only'
import { getDb } from '@/shared/server/db'
import { linkKey } from '@/shared/markdown/meta'
import { linkTargets } from '@/features/notes/link-resolve'
import { folderPathMap } from '@/features/notes/server/notes'
import type { GraphData, GraphEdge, GraphNode } from '../types'

/**
 * Alle Notizen (ohne Papierkorb und Tresor) mit den Wikilinks zwischen ihnen. Links auf Notizen, die es nicht gibt,
 * fallen weg. Die Ziele werden wie bei „Verlinkt in“ über linkKey(Titel) und den Ordner im Link aufgelöst – in
 * JavaScript statt per SQL lower(), das Umlaute nicht kleinschreibt.
 */
export function getGraph(userId: number): GraphData {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT n.id, n.title, n.folder_id AS folderId,
              (SELECT GROUP_CONCAT(tag, char(31)) FROM note_tags t WHERE t.note_id = n.id) AS tags
       FROM notes n WHERE n.user_id = ? AND n.deleted_at IS NULL AND n.vault = 0
       ORDER BY n.title COLLATE NOCASE, n.id`,
    )
    .all(userId) as { id: string; title: string; folderId: string | null; tags: string | null }[]
  const links = db
    .prepare(
      `SELECT l.note_id AS source, l.target, l.path FROM note_links l JOIN notes n ON n.id = l.note_id
       WHERE n.user_id = ? AND n.deleted_at IS NULL AND n.vault = 0 ORDER BY l.note_id, l.target, l.path`,
    )
    .all(userId) as { source: string; target: string; path: string }[]

  // Gleiche Titel in verschiedenen Ordnern: Ein Link zählt – wie bei „Verlinkt in“ – nur für die Notizen, die er meint
  // (Ordner im Link, sonst die im Ordner der verlinkenden Notiz); ist das nicht eindeutig, für jede dieser Notizen
  const byKey = new Map<string, typeof rows>()
  for (const r of rows) {
    const key = linkKey(r.title)
    const list = byKey.get(key)
    if (list) list.push(r)
    else byKey.set(key, [r])
  }
  const paths = folderPathMap(userId)
  const foldersOf = (n: { folderId: string | null }) => (n.folderId ? (paths.get(n.folderId) ?? []) : [])
  const folderOf = new Map(rows.map((r) => [r.id, r.folderId]))
  const edges: GraphEdge[] = []
  const seen = new Set<string>()
  const degree = new Map<string, number>()
  for (const { source, target, path } of links) {
    const candidates = byKey.get(target) ?? []
    for (const { id } of linkTargets(candidates, path ? path.split('/') : [], foldersOf, folderOf.get(source) ?? null)) {
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
