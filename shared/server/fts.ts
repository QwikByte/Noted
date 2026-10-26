import 'server-only'
// Gemeinsame Bausteine für die Volltextsuche (SQLite FTS5) in Notizen und Anhängen

/** Markieren in snippet() den Treffer – der Browser macht daraus <mark> */
export const SNIPPET_START = '\u0002'
export const SNIPPET_END = '\u0003'

// In Anführungszeichen wirken Sonderzeichen wie * oder ( nicht als Syntax; bei Phrasen ist das letzte Wort ein Präfix
const quote = (t: string) => `"${t.replace(/"/g, '""')}"*`

/**
 * FTS5-Abfrage aus Wörtern und Phrasen (alle müssen vorkommen, als Präfix) und Ausschlüssen. null ohne Wort oder
 * Phrase: Nur ausschließen kann FTS5 nicht.
 */
export function buildFtsQuery(q: { terms: string[]; phrases: string[]; excluded: string[] }): string | null {
  const positive = [...q.terms, ...q.phrases].map(quote)
  if (positive.length === 0) return null
  return [positive.join(' '), ...q.excluded.map((e) => `NOT ${quote(e)}`)].join(' ')
}

/** Abfrage „eins der ausgeschlossenen Wörter kommt vor“ – zum Filtern, wenn es kein positives Wort gibt */
export function buildExclusionQuery(excluded: string[]): string | null {
  return excluded.length ? excluded.map(quote).join(' OR ') : null
}
