// Suchanfrage der Volltextsuche zerlegen – auf dem Server für FTS5, im Browser z. B. zum Hervorheben im PDF

/** Wörter für die Volltextsuche und #tags (ohne #, kleingeschrieben) – höchstens 12 Teile */
export function parseSearch(query: string): { terms: string[]; tags: string[] } {
  const parts = query.trim().split(/\s+/).filter(Boolean).slice(0, 12)
  const tags = parts.filter((p) => p.startsWith('#') && p.length > 1).map((p) => p.slice(1).toLowerCase())
  const terms = parts
    .filter((p) => !p.startsWith('#'))
    .map((p) => p.replace(/[\u0000-\u001f]/g, ''))
    .filter(Boolean)
  return { terms, tags }
}
