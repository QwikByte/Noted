// Fundstellen der Volltextsuche im Text einer Notiz – nach denselben Regeln wie SQLite FTS5 (unicode61,
// remove_diacritics): Wortanfang, Groß-/Kleinschreibung und Akzente egal. „ubung“ findet also „Übungen“.

export type TextMatch = { from: number; to: number }

const MAX_MATCHES = 500
const WORD_CHAR = /[\p{L}\p{N}]/u
const MARKS = /\p{M}/gu

/** Ein Zeichen ohne Akzente und klein – kann mehrere Zeichen ergeben (z. B. „İ“) oder keins (allein stehender Akzent) */
function fold(ch: string): string {
  const code = ch.charCodeAt(0)
  if (code < 0x80) return code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : ch
  return ch.normalize('NFD').replace(MARKS, '').toLowerCase()
}

const foldText = (text: string) => Array.from(text, fold).join('')

/**
 * Text in Vergleichsform – je Zeichen mit seiner Stelle im Original, damit Treffer genau dort markiert werden, wo sie
 * stehen (auch wenn ein Zeichen beim Vereinfachen kürzer oder länger wird)
 */
function folded(text: string): { norm: string; start: number[]; end: number[] } {
  let norm = ''
  const start: number[] = []
  const end: number[] = []
  let i = 0
  for (const ch of text) {
    const f = fold(ch)
    for (let k = 0; k < f.length; k++) {
      start.push(i)
      end.push(i + ch.length)
    }
    norm += f
    i += ch.length
  }
  return { norm, start, end }
}

/** Suchwörter in Vergleichsform – ohne Satzzeichen am Rand, die FTS5 ohnehin nicht mitsucht */
function foldTerms(terms: string[]): string[] {
  const out = new Set<string>()
  for (const t of terms) {
    const f = foldText(t).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    if (f) out.add(f)
  }
  return [...out]
}

/** Alle Stellen, an denen ein Wort mit einem der Suchwörter beginnt – sortiert, ohne Überlappung, höchstens 500 */
export function findMatches(text: string, terms: string[]): TextMatch[] {
  const words = foldTerms(terms)
  if (words.length === 0 || !text) return []
  const { norm, start, end } = folded(text)
  const found: TextMatch[] = []
  for (const word of words) {
    for (let at = norm.indexOf(word); at >= 0; at = norm.indexOf(word, at + 1)) {
      if (at > 0 && WORD_CHAR.test(norm[at - 1])) continue
      found.push({ from: start[at], to: end[at + word.length - 1] })
      // Je Wort genügt die Obergrenze – zusammen mit den anderen wird ohnehin gekürzt
      if (found.length >= MAX_MATCHES * words.length) break
    }
  }
  found.sort((a, b) => a.from - b.from || b.to - a.to)
  const out: TextMatch[] = []
  for (const m of found) {
    const last = out[out.length - 1]
    if (last && m.from < last.to) last.to = Math.max(last.to, m.to)
    else out.push({ ...m })
    if (out.length > MAX_MATCHES) break
  }
  return out.slice(0, MAX_MATCHES)
}
