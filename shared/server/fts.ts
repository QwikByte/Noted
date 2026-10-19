import 'server-only'
// Gemeinsame Bausteine für die Volltextsuche (SQLite FTS5) in Notizen und Anhängen

/** Markieren in snippet() den Treffer – der Browser macht daraus <mark> */
export const SNIPPET_START = '\u0002'
export const SNIPPET_END = '\u0003'

/** Suchanfrage zerlegen: Wörter für die Volltextsuche und #tags (ohne #, kleingeschrieben) */
export function parseSearch(query: string): { terms: string[]; tags: string[] } {
  const parts = query.trim().split(/\s+/).filter(Boolean).slice(0, 12)
  const tags = parts.filter((p) => p.startsWith('#') && p.length > 1).map((p) => p.slice(1).toLowerCase())
  const terms = parts
    .filter((p) => !p.startsWith('#'))
    .map((p) => p.replace(/[\u0000-\u001f]/g, ''))
    .filter(Boolean)
  return { terms, tags }
}

/** FTS5-Abfrage: Jedes Wort ist ein Präfix in Anführungszeichen – Sonderzeichen wie * oder ( wirken nicht als Syntax */
export function buildFtsQuery(terms: string[]): string {
  return terms.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' ')
}
