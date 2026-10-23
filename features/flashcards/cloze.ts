// Lückentext-Karten: Lücken stehen als ==Markierung== im Text, {{Lücke}} wird beim Speichern dazu umgewandelt.
// Jede Lücke wird einzeln abgefragt, der Rest bleibt sichtbar.
// Reine Logik ohne Browser- oder Server-Abhängigkeit.

const MARK_RE = /==(?!=)([^\n]+?)==/g
const CURLY_RE = /\{\{(?!\{)([^\n]+?)\}\}/g
const CODE_RE = /(`+)[^`\n][^\n]*?\1/g
/** Platzhalter der Notizvorlagen sind keine Lücken */
const TEMPLATE_PLACEHOLDER_RE = /^(date|time|title)(:[^}]*)?$/i

/** Inline-Code durch Leerzeichen gleicher Länge ersetzen – darin ist == bzw. {{ keine Lücke */
const maskCode = (text: string) => text.replace(CODE_RE, (m) => ' '.repeat(m.length))

type Span = { start: number; end: number; inner: string }

function spans(text: string, re: RegExp): Span[] {
  const out: Span[] = []
  for (const m of maskCode(text).matchAll(re)) {
    const inner = text.slice(m.index + 2, m.index + m[0].length - 2)
    if (inner.trim() && !(re === CURLY_RE && TEMPLATE_PLACEHOLDER_RE.test(inner.trim()))) {
      out.push({ start: m.index, end: m.index + m[0].length, inner })
    }
  }
  return out
}

/** {{Lücke}} → ==Lücke== (Inline-Code bleibt unberührt) */
export function normalizeCloze(text: string): string {
  let out = ''
  let pos = 0
  for (const s of spans(text, CURLY_RE)) {
    out += `${text.slice(pos, s.start)}==${s.inner}==`
    pos = s.end
  }
  return out + text.slice(pos)
}

export const clozeCount = (text: string) => spans(text, MARK_RE).length

/** Enthält der Text Lücken – als ==Markierung== oder {{…}}? */
export const hasCloze = (text: string) => clozeCount(normalizeCloze(text)) > 0

/** Text, in dem jede Lücke durch `replace` ersetzt ist */
function render(text: string, replace: (inner: string, index: number) => string): string {
  let out = ''
  let pos = 0
  spans(text, MARK_RE).forEach((s, i) => {
    out += text.slice(pos, s.start) + replace(s.inner, i)
    pos = s.end
  })
  return out + text.slice(pos)
}

const GAP = '<span class="cloze-gap">[…]</span>'

/** Frage: die abgefragte Lücke als Platzhalter, die übrigen ausgefüllt */
export const clozeQuestion = (text: string, index: number) => render(text, (inner, i) => (i === index ? GAP : inner))

/** Antwort: der ganze Text, die abgefragte Lücke hervorgehoben */
export const clozeAnswer = (text: string, index: number) => render(text, (inner, i) => (i === index ? `==${inner}==` : inner))

/** Alle Lücken als Platzhalter – z. B. für einen Fragebogen auf Papier */
export const clozeBlanks = (text: string) => render(text, () => GAP)

/** Inhalt der abgefragten Lücke (z. B. zum Vergleich beim Eintippen) */
export const clozeText = (text: string, index: number) => spans(text, MARK_RE)[index]?.inner ?? ''

/** Inhalt aller Lücken in ihrer Reihenfolge */
export const clozeTexts = (text: string) => spans(text, MARK_RE).map((s) => s.inner)
