// Anki-Import: Felder (HTML mit Anki-Syntax) in Karten-Markdown umwandeln, Kartenart und Lernstand übernehmen.
// Reine Logik ohne Browser- oder Server-Abhängigkeit – das Lesen der .apkg-Datei macht server/anki.ts.
import { decodeEntities } from '@/shared/lib/html'
import { DAY } from './srs'
import type { CardType, SrsState } from './types'

const CLOZE_RE = /\{\{c(\d+)::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g
const TAG_RE = /<(?!\/?(sub|sup)\b)[^>]*>/gi

/**
 * Alle Tags außer <sub> und <sup> entfernen – Hoch- und Tiefstellung bleiben als HTML (Markdown kennt sie nicht).
 * Wiederholt, bis nichts mehr wegfällt: Aus „<scr<b>ipt>“ darf kein neues Tag entstehen.
 */
function stripTags(html: string): string {
  let out = html
  for (let prev = ''; prev !== out; ) {
    prev = out
    out = out.replace(TAG_RE, '')
  }
  return out
}

/** Nummern der Lücken ({{c1::…}}) in der Reihenfolge des Texts */
export function ankiClozeNumbers(field: string): number[] {
  return [...field.matchAll(CLOZE_RE)].map((m) => Number(m[1]))
}

/** Dateinamen, auf die ein Feld verweist (Bilder, Töne) */
export function ankiMediaRefs(field: string): string[] {
  const out: string[] = []
  for (const m of field.matchAll(/<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) out.push(m[1] ?? m[2] ?? m[3])
  for (const m of field.matchAll(/\[sound:([^\]]+)\]/g)) out.push(m[1])
  return out.map((n) => decodeEntities(n).trim()).filter(Boolean)
}

/**
 * Feld → Markdown: Lücken als ==…== (Hinweise fallen weg), MathJax als $…$, Bilder und Töne als ![[Anhang]]
 * (`media` liefert den Namen des importierten Anhangs), einfache Formatierung als Markdown, Rest ohne Tags.
 */
export function ankiFieldToMarkdown(html: string, media: (name: string) => string | null): string {
  const embed = (name: string) => {
    const file = media(decodeEntities(name).trim())
    return file ? `![[${file}]]` : ''
  }
  const text = html
    .replace(/\r\n?/g, '\n')
    .replace(CLOZE_RE, (_, _n, inner: string) => `==${inner}==`)
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, tex: string) => `$$${tex}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, tex: string) => `$${tex.trim()}$`)
    .replace(/\[latex\]([\s\S]*?)\[\/latex\]/gi, (_, tex: string) => `$$${tex.trim()}$$`)
    .replace(/\[\$\$\]([\s\S]*?)\[\/\$\$\]/g, (_, tex: string) => `$$${tex.trim()}$$`)
    .replace(/\[\$\]([\s\S]*?)\[\/\$\]/g, (_, tex: string) => `$${tex.trim()}$`)
    .replace(/\[sound:([^\]]+)\]/g, (_, name: string) => embed(name))
    .replace(/<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi, (_, a, b, c) => embed(a ?? b ?? c))
    // Anki setzt jede weitere Zeile in ein <div> – ein neues Element beginnt also eine neue Zeile
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<(div|p|h[1-6]|tr|blockquote)\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(p|ul|ol|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<\/?(b|strong)\b[^>]*>/gi, '**')
    .replace(/<\/?(i|em)\b[^>]*>/gi, '*')
  return decodeEntities(stripTags(text))
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\*\*\s*\*\*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Name eines Anki-Stapels – Unterstapel („Uni::Analysis“) werden zu „Uni – Analysis“ */
export function ankiDeckName(name: string): string {
  return (
    name
      .split(/\x1f|::/)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(' – ')
      .slice(0, 200) || 'Anki'
  )
}

type AnkiNote = { fields: string[]; ords: number[] }

/**
 * Kartenart und Seiten einer Anki-Notiz: Lücken in einem Feld → Lückentext, zwei Karten (ord 0 und 1) → beidseitig,
 * sonst Grundkarte. `sideOfOrd` ordnet einer Anki-Karte die Kartenseite zu – bei Lückentexten nur, wenn die Lücken
 * in Reihenfolge c1, c2, … stehen (sonst beginnt der Lernstand neu).
 */
export function ankiCardKind(note: AnkiNote): { type: CardType; sideOfOrd: (ord: number) => number | null } {
  const numbers = ankiClozeNumbers(note.fields[0] ?? '')
  if (numbers.length > 0) {
    const ordered = numbers.every((n, i) => n === i + 1)
    return { type: 'cloze', sideOfOrd: (ord) => (ordered && ord < numbers.length ? ord : null) }
  }
  if (note.ords.includes(0) && note.ords.includes(1)) return { type: 'reversed', sideOfOrd: (ord) => (ord <= 1 ? ord : null) }
  return { type: 'basic', sideOfOrd: (ord) => (ord === 0 ? 0 : null) }
}

/** Planungsdaten einer Anki-Karte (Tabelle cards) */
export type AnkiCard = {
  type: number
  queue: number
  due: number
  ivl: number
  factor: number
  reps: number
  lapses: number
}

/**
 * Lernstand einer Anki-Karte. Neue Karten (type 0) haben keinen. Fälligkeit: Wiederholungen in Tagen seit dem
 * Anlegen der Sammlung (`crt`, Sekunden), Lernschritte als Zeitpunkt in Sekunden. `lastReview`: letzte Bewertung (ms).
 */
export function ankiState(card: AnkiCard, crt: number, lastReview: number | null, now: number): SrsState | null {
  if (card.type === 0 || card.queue === 0) return null
  const ease = Math.max(1.3, Math.min(10, card.factor > 0 ? card.factor / 1000 : 2.5))
  const reviewedAt = lastReview ?? now
  const base = { step: 0, ease, reps: card.reps, lapses: card.lapses, reviewedAt, introducedAt: reviewedAt }
  if (card.type === 2) {
    return { ...base, phase: 'review', interval: Math.max(1, card.ivl), due: (crt + card.due * 86_400) * 1000 }
  }
  // Lernphase: Fälligkeit als Zeitpunkt (Sekunden) oder – bei Lernschritten über Tage – als Tag seit crt
  const due = card.due > 1_000_000_000 ? card.due * 1000 : (crt + card.due * 86_400) * 1000
  return { ...base, phase: card.type === 3 ? 'relearning' : 'learning', interval: Math.max(0, card.ivl), due: due || now + DAY }
}
