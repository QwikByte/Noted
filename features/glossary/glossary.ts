// Glossar und Formelsammlung aus Notizen: Definitionen erkennt dieselbe Logik wie „Karteikarten aus Notiz“
// (Info-Callouts, fett gedruckte Begriffe mit Erklärung), Formeln sind LaTeX-Blöcke ($$…$$). Jeder Eintrag merkt sich
// die Überschrift darüber – als Zusammenhang und als Sprungziel in die Notiz.
import { parseCardsFromNote } from '@/features/flashcards/card-markdown'
import { splitFrontmatter, stripCode } from '@/shared/markdown/meta'
import type { Glossary, GlossaryFormula, GlossarySource, GlossaryTerm } from './types'

/** Höchstens so viele Begriffe bzw. Formeln in einer Antwort */
export const MAX_ENTRIES = 5000

const HEADING_RE = /^#{1,6}[ \t]+(.+?)[ \t#]*$/
const FORMULA_RE = /\$\$([\s\S]+?)\$\$/g

export type GlossaryNote = { id: string; title: string; text: string }

/** Überschrift über jeder Zeile (Zeilen inkl. Frontmatter) */
function headingsByLine(text: string): (string | null)[] {
  const fm = splitFrontmatter(text)
  const offset = fm ? fm.lines : 0
  const lines = stripCode(text).split('\n')
  const out: (string | null)[] = []
  let current: string | null = null
  lines.forEach((line, i) => {
    const m = i >= offset ? HEADING_RE.exec(line) : null
    if (m) current = m[1]
    out.push(current)
  })
  return out
}

function noteEntries(note: GlossaryNote): { terms: GlossaryTerm[]; formulas: GlossaryFormula[] } {
  const headings = headingsByLine(note.text)
  const source = (line: number): GlossarySource => ({ noteId: note.id, noteTitle: note.title, heading: headings[line] ?? null })

  const terms = parseCardsFromNote(note.text)
    .filter((c) => (c.source === 'definition' || c.source === 'bold') && c.back.trim())
    .map((c) => ({ ...source(c.line), term: c.front, definition: c.back }))

  // Code und Kommentare sind ausgeblendet (gleiche Länge), die Positionen stimmen also mit dem Original überein
  const stripped = stripCode(note.text)
  const formulas: GlossaryFormula[] = []
  for (const m of stripped.matchAll(FORMULA_RE)) {
    const tex = m[1].trim()
    if (!tex) continue
    const line = stripped.slice(0, m.index).split('\n').length - 1
    formulas.push({ ...source(line), tex })
  }
  return { terms, formulas }
}

const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true })

/** Begriffe alphabetisch, Formeln nach Notiz und Reihenfolge darin */
export function buildGlossary(notes: GlossaryNote[]): Glossary {
  const terms: GlossaryTerm[] = []
  const formulas: GlossaryFormula[] = []
  for (const note of [...notes].sort((a, b) => collator.compare(a.title, b.title))) {
    const found = noteEntries(note)
    terms.push(...found.terms)
    formulas.push(...found.formulas)
  }
  terms.sort((a, b) => collator.compare(a.term, b.term) || collator.compare(a.noteTitle, b.noteTitle))
  return {
    terms: terms.slice(0, MAX_ENTRIES),
    formulas: formulas.slice(0, MAX_ENTRIES),
    truncated: terms.length > MAX_ENTRIES || formulas.length > MAX_ENTRIES,
  }
}

/** Anfangsbuchstabe für die Gliederung der Begriffe – Ziffern und Zeichen unter „#“ */
export function initialOf(term: string): string {
  const letter = term
    .replace(/[^\p{L}\p{N}]/gu, '')
    .charAt(0)
    .normalize('NFD')
    .charAt(0)
    .toUpperCase()
    .charAt(0)
  return /\p{L}/u.test(letter) ? letter : '#'
}

const link = (s: GlossarySource) => `[[${s.noteTitle}${s.heading ? `#${s.heading}` : ''}]]`

/** Als Markdown (z. B. als Spickzettel) – mit Links zurück an die Stelle in der Notiz */
export function glossaryToMarkdown(title: string, terms: GlossaryTerm[], formulas: GlossaryFormula[]): string {
  const parts = [`# ${title}`]
  if (terms.length > 0) {
    parts.push('## Begriffe')
    for (const t of terms) parts.push(`**${t.term}** · ${link(t)}\n${t.definition.trim()}`)
  }
  if (formulas.length > 0) {
    parts.push('## Formeln')
    let note = ''
    for (const f of formulas) {
      if (f.noteId !== note) {
        note = f.noteId
        parts.push(`### [[${f.noteTitle}]]`)
      }
      parts.push(`${f.heading ? `${f.heading} · ${link(f)}\n` : ''}$$\n${f.tex}\n$$`)
    }
  }
  return parts.join('\n\n') + '\n'
}
