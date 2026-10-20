// Typen der Graph-Ansicht (API-Vertrag zwischen Server und Browser)

/** Notiz als Knoten – links: Zahl der Verbindungen (ein- und ausgehend) */
export type GraphNode = {
  id: string
  title: string
  folderId: string | null
  tags: string[]
  links: number
}

/** Wikilink von source auf target (Notiz-IDs) */
export type GraphEdge = { source: string; target: string }

export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] }
