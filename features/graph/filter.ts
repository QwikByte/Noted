// Filter und Darstellung der Graph-Ansicht – reine Logik ohne DOM
import type { GraphData, GraphNode } from './types'

/** Ab so vielen Knoten wird der Gesamtgraph nicht mehr gezeichnet, nur noch ein gefilterter Ausschnitt */
export const GRAPH_NODE_LIMIT = 1500

/**
 * Nur Notizen in den Ordnern `folderIds` (null = alle) und mit dem Tag `tag` (auch verschachtelt: „uni“ trifft
 * „uni/mathe“) – samt den Kanten zwischen ihnen.
 */
export function filterGraph(graph: GraphData, filter: { folderIds: Set<string> | null; tag: string | null }): GraphData {
  const tag = filter.tag?.toLowerCase() ?? null
  const nodes = graph.nodes.filter(
    (n) =>
      (!filter.folderIds || (n.folderId !== null && filter.folderIds.has(n.folderId))) &&
      (!tag || n.tags.some((t) => t === tag || t.startsWith(`${tag}/`))),
  )
  if (nodes.length === graph.nodes.length) return graph
  const kept = new Set(nodes.map((n) => n.id))
  return { nodes, edges: graph.edges.filter((e) => kept.has(e.source) && kept.has(e.target)) }
}

/** Durchmesser eines Knotens: wächst mit der Zahl der Verbindungen, höchstens auf das Vierfache */
export function nodeSize(links: GraphNode['links'], base = 10): number {
  return base * Math.min(4, 1 + Math.sqrt(links) * 0.6)
}

/** Farbnummer (1–6, wie im Kalender) je oberstem Ordner – alphabetisch verteilt, damit sie stabil bleibt */
export function rootColors(roots: { id: string; name: string }[]): Map<string, number> {
  const sorted = [...roots].sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base', numeric: true }))
  return new Map(sorted.map((r, i) => [r.id, (i % 6) + 1]))
}
