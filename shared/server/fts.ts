import 'server-only'
// Gemeinsame Bausteine für die Volltextsuche (SQLite FTS5) in Notizen und Anhängen

/** Markieren in snippet() den Treffer – der Browser macht daraus <mark> */
export const SNIPPET_START = '\u0002'
export const SNIPPET_END = '\u0003'

/** FTS5-Abfrage: Jedes Wort ist ein Präfix in Anführungszeichen – Sonderzeichen wie * oder ( wirken nicht als Syntax */
export function buildFtsQuery(terms: string[]): string {
  return terms.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' ')
}
