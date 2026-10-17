// Antwort eintippen: die eigene Antwort mit der richtigen vergleichen und Unterschiede auf Zeichenebene markieren.
// Groß- und Kleinschreibung, Leerzeichen und Satzzeichen am Ende zählen nicht – Akzente und Umlaute schon,
// weil sie z. B. bei Vokabeln zur Antwort gehören.

/** same: stimmt überein · extra: eingetippt, gehört nicht dazu · missing: fehlt in der Eingabe */
export type DiffPart = { kind: 'same' | 'extra' | 'missing'; text: string }

export type TypedResult = { correct: boolean; parts: DiffPart[] }

/** Über dieser Größe (Zeichen × Zeichen) wird nicht mehr zeichenweise verglichen */
const MAX_CELLS = 250_000

/** Klartext einer Antwort aus Karten-Markdown: ohne Formatierung, Bilder und Kommentare, Links als ihr Text. */
export function answerText(markdown: string): string {
  return markdown
    .replace(/%%[\s\S]*?%%/g, ' ')
    .replace(/<\/?[a-z][^>\n]*>/gi, ' ')
    .replace(/!\[\[[^[\]\n]*\]\]/g, ' ')
    .replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, ' ')
    .replace(/\[\[([^[\]|\n]*)(?:\|([^[\]\n]*))?\]\]/g, (_, target: string, alias?: string) => alias ?? target)
    .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/^[ \t]*(#{1,6}[ \t]+|>[ \t]*(\[![^\]]*\][+-]?[ \t]*)?|[-*+][ \t]+(\[.\][ \t]+)?|\d+[.)][ \t]+)/gm, '')
    .replace(/\$\$([\s\S]+?)\$\$|\$([^$\n]+)\$/g, (_, block?: string, inline?: string) => block ?? inline ?? '')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/(\*\*|__|==|~~)(.+?)\1/g, '$2')
    // Kursiv nur an Wortgrenzen – snake_case bleibt stehen
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=$|[^\w*])/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
}

const prepare = (s: string) =>
  s
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s.,;:!?]+$/, '')

const sameChar = (a: string, b: string) => a === b || a.toLocaleLowerCase('de') === b.toLocaleLowerCase('de')

function push(parts: DiffPart[], kind: DiffPart['kind'], text: string) {
  if (!text) return
  const last = parts[parts.length - 1]
  if (last?.kind === kind) last.text += text
  else parts.push({ kind, text })
}

/** Vergleicht die Eingabe mit der richtigen Antwort (Klartext, siehe `answerText`). */
export function compareAnswer(typed: string, expected: string): TypedResult {
  const a = Array.from(prepare(typed))
  const b = Array.from(prepare(expected))
  const parts: DiffPart[] = []
  const correct = a.length === b.length && a.every((c, i) => sameChar(c, b[i]))
  if (correct) {
    push(parts, 'same', a.join(''))
    return { correct, parts }
  }
  const n = a.length
  const m = b.length
  if (n * m > MAX_CELLS) {
    push(parts, 'extra', a.join(''))
    push(parts, 'missing', b.join(''))
    return { correct, parts }
  }
  // Längste gemeinsame Teilfolge, von hinten berechnet – dann von vorn ablesen
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = sameChar(a[i], b[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    // Ein Zeichen nur zuordnen, wenn es später nicht genauso gut passt – sonst zerfällt „the house“ gegen „house“
    // in „h“ + „e h“ + „ouse“ statt „the “ + „house“
    if (sameChar(a[i], b[j]) && lcs[i + 1][j] < lcs[i][j] && lcs[i][j + 1] < lcs[i][j]) {
      push(parts, 'same', a[i++])
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) push(parts, 'extra', a[i++])
    else push(parts, 'missing', b[j++])
  }
  push(parts, 'extra', a.slice(i).join(''))
  push(parts, 'missing', b.slice(j).join(''))
  return { correct, parts }
}
