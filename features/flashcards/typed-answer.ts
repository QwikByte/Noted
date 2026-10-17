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
  // Längste gemeinsame Teilfolge der Anfänge, von hinten abgelesen: Übereinstimmungen liegen so möglichst weit hinten
  // („the house“ gegen „house“ ergibt „the “ + „house“), bei einem falschen Zeichen steht das falsche vor dem richtigen
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      lcs[i][j] = sameChar(a[i - 1], b[j - 1]) ? lcs[i - 1][j - 1] + 1 : Math.max(lcs[i - 1][j], lcs[i][j - 1])
    }
  }
  const reversed: DiffPart[] = []
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    if (sameChar(a[i - 1], b[j - 1])) {
      reversed.push({ kind: 'same', text: a[--i] })
      j--
    } else if (lcs[i][j - 1] >= lcs[i - 1][j]) reversed.push({ kind: 'missing', text: b[--j] })
    else reversed.push({ kind: 'extra', text: a[--i] })
  }
  push(parts, 'extra', a.slice(0, i).join(''))
  push(parts, 'missing', b.slice(0, j).join(''))
  for (const part of reversed.reverse()) push(parts, part.kind, part.text)
  return { correct, parts }
}
