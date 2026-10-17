// Karteikarten ↔ Markdown
//
// - Karten in Notizen erkennen („Karteikarten aus Notiz“): Syntax des Obsidian-Plugins „Spaced Repetition“
//   (Frage::Antwort, Frage:::Antwort, mehrzeilig mit ? bzw. ??), Multiple Choice als Aufgabenliste nach dem ?,
//   Frage-Callouts (> [!question] …), Definitionen (> [!info] Begriff, **Begriff**: …), Überschriften und
//   Lückentexte (Absätze mit {{Lücke}} oder ==Markierung==).
// - Stapel als Markdown im selben Format ausgeben (Export, „Als Markdown kopieren“) – so lassen sie sich in
//   Obsidian mit dem Spaced-Repetition-Plugin weiterlernen.
import { splitFrontmatter } from '@/shared/markdown/meta'
import { hasCloze, normalizeCloze } from './cloze'
import type { Card, CardOption, CardType, Deck } from './types'

export type CandidateSource = 'syntax' | 'question' | 'cloze' | 'definition' | 'bold' | 'highlight' | 'heading'

export type CardDraft = { type: CardType; front: string; back: string; options: CardOption[] }

export type CardCandidate = CardDraft & {
  source: CandidateSource
  /** Zeile in der Notiz (0-basiert, inkl. Frontmatter) */
  line: number
}

export const SOURCE_LABELS: Record<CandidateSource, string> = {
  syntax: 'Karten-Syntax (Frage::Antwort, ?)',
  question: 'Frage-Callouts',
  definition: 'Definitionen (Info-Callouts)',
  bold: 'Fett gedruckte Begriffe',
  cloze: 'Lückentexte ({{Lücke}})',
  highlight: 'Markierungen als Lückentext (==…==)',
  heading: 'Überschriften mit Abschnitt',
}

/** Quellen, die eindeutig als Karte gemeint sind (im Dialog vorausgewählt) – ==Markierungen== sind oft nur Formatierung */
export const EXPLICIT_SOURCES: CandidateSource[] = ['syntax', 'question', 'cloze']

export const FENCE_RE = /^[ \t]*(`{3,}|~{3,})/
export const HEADING_RE = /^(#{1,6})[ \t]+(.+?)[ \t#]*$/
const CALLOUT_RE = /^>[ \t]*\[!([\w-]+)\][+-]?[ \t]*(.*)$/
const TASK_RE = /^[ \t]*[-*+][ \t]+\[([ xX])\][ \t]+(.*)$/
const LIST_PREFIX_RE = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/
const BOLD_DEF_RE = /^[ \t]*(?:[-*+][ \t]+)?\*\*([^*\n]+?)\*\*[ \t]*(?::|–|—|-|=)[ \t]*(\S.*)$/
const BOLD_COLON_RE = /^[ \t]*(?:[-*+][ \t]+)?\*\*([^*\n]+?):\*\*[ \t]*(\S.*)$/

const QUESTION_CALLOUTS = new Set(['question', 'faq', 'help', 'frage'])
const DEFINITION_CALLOUTS = new Set(['info', 'definition', 'def', 'begriff'])

/** Platzhalter aus den Vorlagen nicht als Karte vorschlagen */
const PLACEHOLDERS = new Set(['frage→antwort (zum aufklappen)', 'begriff→erklärung'])

const isBlank = (s: string) => s.trim() === ''

/** Antwortteil: Aufgabenliste = Multiple Choice (übrige Zeilen werden zur Erklärung). */
function answerDraft(front: string, answerLines: string[], reversed = false): CardDraft | null {
  const options: CardOption[] = []
  const rest: string[] = []
  for (const line of answerLines) {
    const m = TASK_RE.exec(line)
    if (m) options.push({ text: m[2].trim(), correct: m[1] !== ' ' })
    else rest.push(line)
  }
  const back = rest.join('\n').trim()
  if (options.length >= 2 && options.some((o) => o.correct)) {
    return { type: 'mc', front: front.trim(), back, options }
  }
  const text = answerLines.join('\n').trim()
  if (!front.trim() || !text) return null
  return { type: reversed ? 'reversed' : 'basic', front: front.trim(), back: text, options: [] }
}

/** Trennt eine Zeile „Frage::Antwort“ bzw. „Frage:::Antwort“ (nicht innerhalb von Inline-Code). */
function splitInline(line: string): { front: string; back: string; reversed: boolean } | null {
  const masked = line.replace(/(`+)[^`]*?\1/g, (m) => ' '.repeat(m.length))
  const idx = masked.indexOf('::')
  if (idx < 0) return null
  const reversed = masked.startsWith(':::', idx)
  const front = line.slice(0, idx).replace(LIST_PREFIX_RE, '').trim()
  const back = line.slice(idx + (reversed ? 3 : 2)).trim()
  if (!front || !back || back.startsWith(':')) return null
  return { front, back, reversed }
}

export type ParseOptions = {
  /** Zeilen „Begriff<Tab>Erklärung“ als Karte (Import aus Quizlet, Anki, Tabellen) */
  tabs?: boolean
}

/** Findet mögliche Karteikarten in einer Notiz. */
export function parseCardsFromNote(content: string, opts: ParseOptions = {}): CardCandidate[] {
  const fm = splitFrontmatter(content)
  const offset = fm ? fm.lines : 0
  const lines = (fm ? fm.body : content).replace(/\r\n?/g, '\n').split('\n')
  const n = lines.length

  // Code-Blöcke überspringen
  const inCode: boolean[] = new Array(n).fill(false)
  let fence: string | null = null
  for (let i = 0; i < n; i++) {
    const m = FENCE_RE.exec(lines[i])
    if (fence) {
      inCode[i] = true
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null
    } else if (m) {
      fence = m[1]
      inCode[i] = true
    }
  }
  const usable = (i: number) => i >= 0 && i < n && !inCode[i]
  const isHeading = (i: number) => HEADING_RE.test(lines[i])
  const isSeparator = (i: number) => {
    const t = lines[i].trim()
    return t === '?' || t === '??'
  }

  const out: CardCandidate[] = []
  const consumed: boolean[] = new Array(n).fill(false)
  const push = (source: CandidateSource, line: number, draft: CardDraft | null) => {
    if (!draft) return
    if (PLACEHOLDERS.has(`${draft.front}→${draft.back}`.toLowerCase())) return
    out.push({ source, line: line + offset, ...draft })
  }

  // 1. Mehrzeilige Karten (Frage / ? / Antwort) – der Absatz vor dem ? ist die Frage, der danach die Antwort
  for (let s = 0; s < n; s++) {
    if (!usable(s) || !isSeparator(s)) continue
    let a = s
    while (a - 1 >= 0 && usable(a - 1) && !consumed[a - 1] && !isBlank(lines[a - 1]) && !isHeading(a - 1) && !isSeparator(a - 1)) a--
    let b = s
    while (b + 1 < n && usable(b + 1) && !isBlank(lines[b + 1]) && !isHeading(b + 1) && !isSeparator(b + 1)) b++
    if (a === s || b === s) continue
    for (let k = a; k <= b; k++) consumed[k] = true
    push('syntax', a, answerDraft(lines.slice(a, s).join('\n'), lines.slice(s + 1, b + 1), lines[s].trim() === '??'))
    s = b
  }

  for (let i = 0; i < n; i++) {
    if (!usable(i) || consumed[i]) continue
    const line = lines[i]

    // 2. Callouts
    const callout = CALLOUT_RE.exec(line)
    if (callout) {
      const kind = callout[1].toLowerCase()
      const body: string[] = []
      let j = i + 1
      while (j < n && /^>/.test(lines[j])) body.push(lines[j++].replace(/^>[ \t]?/, ''))
      for (let k = i; k < j; k++) consumed[k] = true
      let title = callout[2].trim()
      if (QUESTION_CALLOUTS.has(kind) || DEFINITION_CALLOUTS.has(kind)) {
        if (!title) {
          // Ohne Titel: erste Zeile ist die Frage
          const first = body.findIndex((l) => !isBlank(l))
          if (first >= 0) {
            title = body[first].trim()
            body.splice(0, first + 1)
          }
        }
        push(QUESTION_CALLOUTS.has(kind) ? 'question' : 'definition', i, answerDraft(title, body))
      }
      i = j - 1
      continue
    }

    // 3. Überschrift mit dem Abschnitt bis zur nächsten Überschrift
    const heading = HEADING_RE.exec(line)
    if (heading) {
      let j = i + 1
      const section: string[] = []
      while (j < n && !(usable(j) && isHeading(j))) section.push(lines[j++])
      push('heading', i, answerDraft(heading[2].replace(/[*_=]+/g, '').trim(), section))
      continue
    }

    // 4. Einzeilige Karten
    if (opts.tabs && line.includes('\t') && !/^\s/.test(line)) {
      const [front, ...rest] = line.split('\t')
      const back = rest.join(' ').trim()
      if (front.trim() && back) {
        push('syntax', i, { type: 'basic', front: front.trim(), back, options: [] })
        continue
      }
    }
    const inline = line.includes('::') ? splitInline(line) : null
    if (inline) {
      consumed[i] = true
      push('syntax', i, { type: inline.reversed ? 'reversed' : 'basic', front: inline.front, back: inline.back, options: [] })
      continue
    }
    const bold = BOLD_COLON_RE.exec(line) ?? BOLD_DEF_RE.exec(line)
    if (bold) {
      consumed[i] = true
      push('bold', i, { type: 'basic', front: bold[1].trim(), back: bold[2].trim(), options: [] })
    }
  }

  // 5. Lückentexte: ein Absatz mit {{Lücke}} oder ==Markierung== wird eine Karte, jede Lücke einzeln abgefragt
  const free = (k: number) => usable(k) && !consumed[k] && !isBlank(lines[k]) && !isHeading(k) && !isSeparator(k)
  for (let i = 0; i < n; i++) {
    if (!free(i)) continue
    let j = i
    while (j + 1 < n && free(j + 1)) j++
    const text = lines.slice(i, j + 1).join('\n').trim()
    const front = normalizeCloze(text)
    if (hasCloze(front)) {
      // {{Lücke}} ist eindeutig als Lücke gemeint, ==Markierung== oft nur Hervorhebung
      push(front !== text ? 'cloze' : 'highlight', i, { type: 'cloze', front, back: '', options: [] })
    }
    i = j
  }

  return out.sort((x, y) => x.line - y.line)
}

// ---------------------------------------------------------------------------
// Ausgabe als Markdown
// ---------------------------------------------------------------------------

/** Mehrzeilige Karten enden im Spaced-Repetition-Plugin an einer Leerzeile – daher Leerzeilen entfernen. */
const compact = (s: string) => s.replace(/\r\n?/g, '\n').trim().replace(/\n[ \t]*\n+/g, '\n')

export function cardToMarkdown(card: Pick<Card, 'type' | 'front' | 'back' | 'options'>): string {
  const front = compact(card.front)
  // Lückentext: der Absatz mit den ==Lücken== selbst, ein Zusatz in der Zeile darunter
  if (card.type === 'cloze') return [front, ...(card.back.trim() ? [compact(card.back)] : [])].join('\n')
  if (card.type === 'mc') {
    const options = card.options.map((o) => `- [${o.correct ? 'x' : ' '}] ${o.text.replace(/\s*\n\s*/g, ' ').trim()}`)
    const explanation = compact(card.back)
    return [front, '?', ...options, ...(explanation ? [explanation] : [])].join('\n')
  }
  const back = compact(card.back)
  // Einzeilig nur, wenn sich die Zeile eindeutig wieder trennen lässt
  const singleLine =
    !front.includes('\n') && !back.includes('\n') && !front.includes('::') && !front.endsWith(':') && !back.startsWith(':')
  if (singleLine) return `${front}${card.type === 'reversed' ? ':::' : '::'}${back}`
  return [front, card.type === 'reversed' ? '??' : '?', back].join('\n')
}

/** Tag für den Stapel im Spaced-Repetition-Plugin, z. B. #flashcards/Analysis-I */
export function deckTag(name: string): string {
  const slug = name
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}_\-/]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^[-/]+|[-/]+$/g, '')
  return slug ? `flashcards/${slug}` : 'flashcards'
}

export function deckToMarkdown(deck: Pick<Deck, 'name' | 'description'>, cards: Card[]): string {
  const parts = [`---\ntags:\n  - ${deckTag(deck.name)}\n---`]
  if (deck.description.trim()) parts.push(deck.description.trim())
  for (const card of [...cards].sort((a, b) => a.position - b.position || a.createdAt - b.createdAt)) {
    parts.push(cardToMarkdown(card))
  }
  return parts.join('\n\n') + '\n'
}
