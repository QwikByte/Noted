// Suchanfrage der Volltextsuche zerlegen – auf dem Server für FTS5, im Browser z. B. zum Hervorheben im PDF

export type ParsedSearch = {
  /** Wörter, die vorkommen müssen (am Wortanfang) */
  terms: string[]
  /** „Phrasen“ in Anführungszeichen – die Wörter in dieser Reihenfolge */
  phrases: string[]
  /** Mit „-“ ausgeschlossene Wörter und Phrasen */
  excluded: string[]
  /** #tags (ohne #, kleingeschrieben) */
  tags: string[]
  /** Mit „-#“ ausgeschlossene Tags */
  excludedTags: string[]
}

const MAX_PARTS = 12
// Ohne Buchstaben oder Ziffern findet FTS5 nichts – solche Teile fallen weg, statt eine Ausnahme auszulösen
const HAS_WORD = /[\p{L}\p{N}]/u

/**
 * Anfrage zerlegen: `"Satz von Bayes"` ist eine Phrase (ohne schließendes Anführungszeichen bis zum Ende), `-wort`
 * und `-"phrase"` schließen aus, `#tag` und `-#tag` filtern nach Tags. Ein einzelnes „-“ und eins mitten im Wort
 * („E-Mail“) bleiben Text. Höchstens 12 Teile, eine Phrase zählt als einer.
 */
export function parseSearch(query: string): ParsedSearch {
  const out: ParsedSearch = { terms: [], phrases: [], excluded: [], tags: [], excludedTags: [] }
  // Steuerzeichen fallen weg – außer Leerraum (Tab, Zeilenumbruch), der trennt
  const q = query.replace(/[\u0000-\u0008\u000e-\u001f]/g, '')
  let parts = 0
  let i = 0
  while (i < q.length && parts < MAX_PARTS) {
    if (/\s/.test(q[i])) {
      i++
      continue
    }
    const negated = q[i] === '-' && i + 1 < q.length && !/\s/.test(q[i + 1])
    if (negated) i++
    let value: string
    let phrase = false
    if (q[i] === '"') {
      const end = q.indexOf('"', i + 1)
      value = q.slice(i + 1, end < 0 ? q.length : end).trim().replace(/\s+/g, ' ')
      i = end < 0 ? q.length : end + 1
      phrase = true
    } else {
      const start = i
      while (i < q.length && !/\s/.test(q[i])) i++
      value = q.slice(start, i)
    }
    parts++
    const tag = !phrase && value.startsWith('#') && value.length > 1
    if (tag) {
      const list = negated ? out.excludedTags : out.tags
      list.push(value.slice(1).toLowerCase())
    } else if (HAS_WORD.test(value)) {
      const list = negated ? out.excluded : phrase && value.includes(' ') ? out.phrases : out.terms
      list.push(value)
    }
  }
  return out
}

/** Was im Text hervorgehoben wird: Wörter und Phrasen, ohne Ausschlüsse und Tags */
export function highlightTerms(query: string): string[] {
  const { terms, phrases } = parseSearch(query)
  return [...terms, ...phrases]
}

/** Die Wörter und Phrasen einer Anfrage wieder als Text, z. B. für einen Link auf die Fundstelle */
export function positiveQuery(query: string): string {
  const { terms, phrases } = parseSearch(query)
  return [...terms, ...phrases.map((p) => `"${p}"`)].join(' ')
}
