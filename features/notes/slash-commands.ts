// Befehle mit „/“ im Editor: welche es gibt, wann das Menü aufgeht und wie Weitertippen filtert. Rein – ohne Editor,
// Browser oder React –, damit der Markdown-Editor und der formatierte Text dieselben Regeln nutzen.
import { isProseAt } from './markdown-context'
import { fuzzyScore } from './tree'

type SlashCommand = {
  id: string
  label: string
  /** Ergänzen den Namen beim Filtern – auch ohne Umlaut und auf Englisch */
  keywords: readonly string[]
  /** Markdown-Syntax, steht rechts im Menü */
  hint?: string
  /** Auch im formatierten Text */
  richText: boolean
}

const HEADING = ['ueberschrift', 'heading', 'titel']

/** Reihenfolge = Anzeige bei leerem Filter */
export const SLASH_COMMANDS = [
  { id: 'h1', label: 'Überschrift 1', keywords: ['h1', ...HEADING], hint: '#', richText: true },
  { id: 'h2', label: 'Überschrift 2', keywords: ['h2', ...HEADING], hint: '##', richText: true },
  { id: 'h3', label: 'Überschrift 3', keywords: ['h3', ...HEADING], hint: '###', richText: true },
  { id: 'bullet', label: 'Aufzählung', keywords: ['liste', 'punkte', 'bullet', 'list'], hint: '-', richText: true },
  { id: 'ordered', label: 'Nummerierte Liste', keywords: ['nummeriert', 'zahlen', 'ordered'], hint: '1.', richText: true },
  { id: 'task', label: 'Aufgabe', keywords: ['todo', 'checkbox', 'task'], hint: '- [ ]', richText: true },
  { id: 'quote', label: 'Zitat', keywords: ['quote'], hint: '>', richText: true },
  {
    id: 'callout',
    label: 'Callout …',
    keywords: ['hinweis', 'info', 'achtung', 'warnung', 'tipp', 'merke'],
    hint: '> [!…]',
    richText: false,
  },
  { id: 'table', label: 'Tabelle', keywords: ['table'], hint: '| … |', richText: true },
  { id: 'math', label: 'Formel im Text', keywords: ['formel', 'mathe', 'latex', 'math'], hint: '$…$', richText: false },
  { id: 'mathBlock', label: 'Formel-Block', keywords: ['formel', 'mathe', 'latex', 'gleichung'], hint: '$$…$$', richText: false },
  { id: 'code', label: 'Code-Block', keywords: ['code', 'quelltext'], hint: '```', richText: true },
  { id: 'mermaid', label: 'Diagramm (Mermaid)', keywords: ['mermaid', 'flowchart', 'ablauf'], hint: '```mermaid', richText: false },
  { id: 'divider', label: 'Trennlinie', keywords: ['linie', 'trenner', 'hr'], hint: '---', richText: true },
  { id: 'wikilink', label: 'Wikilink', keywords: ['link', 'verweis', 'notiz'], hint: '[[…]]', richText: false },
  { id: 'flashcard', label: 'Karteikarte', keywords: ['frage', 'antwort', 'karte', 'flashcard'], hint: 'Frage::Antwort', richText: true },
  { id: 'date', label: 'Datum von heute', keywords: ['heute', 'today', 'date'], hint: 'JJJJ-MM-TT', richText: true },
  {
    id: 'file',
    label: 'Bild oder Datei …',
    keywords: ['bild', 'foto', 'datei', 'upload', 'anhang', 'pdf'],
    hint: '![[…]]',
    richText: true,
  },
] as const satisfies readonly SlashCommand[]

export type SlashEntry = (typeof SLASH_COMMANDS)[number]
export type SlashCommandId = SlashEntry['id']
export type RichSlashCommandId = Extract<SlashEntry, { richText: true }>['id']

/**
 * „/“ am Zeilen- bzw. Absatzanfang oder nach Leerraum, danach höchstens 20 Buchstaben und Ziffern – so lösen
 * „und/oder“, „12/10/2026“, Adressen und Pfade nie aus. `offset`: Stelle des „/“ in `textBefore`.
 */
export function matchSlash(textBefore: string): { offset: number; query: string } | null {
  const m = /(?:^|\s)\/([\p{L}\p{N}]{0,20})$/u.exec(textBefore)
  return m ? { offset: textBefore.length - m[1].length - 1, query: m[1] } : null
}

/**
 * Menü im Markdown an der Cursorposition `pos`? Nicht in Properties, Code, Kommentaren, Formeln, nach einem offenen
 * „[[“ und in Tabellenzeilen. `from`: Position des „/“.
 */
export function markdownSlashAt(doc: string, pos: number): { from: number; query: string } | null {
  const lineStart = doc.lastIndexOf('\n', pos - 1) + 1
  const line = doc.slice(lineStart, pos)
  const m = matchSlash(line)
  if (!m) return null
  const from = lineStart + m.offset
  const head = line.slice(0, m.offset)
  if (line.trimStart().startsWith('|') || head.lastIndexOf('[[') > head.lastIndexOf(']]')) return null
  return isProseAt(doc, from) ? { from, query: m.query } : null
}

/**
 * Befehle zum getippten Filter – bester Wert aus Name und Stichwörtern. Es zählen nur Wortanfänge und zusammenhängende
 * Teilwörter, keine verstreuten Buchstaben (sonst fände „bin“ „Bild oder Datei“).
 */
export function filterSlashCommands(query: string, opts: { richText: boolean; inTable?: boolean }): SlashEntry[] {
  const list: SlashEntry[] = SLASH_COMMANDS.filter(
    (c) => (!opts.richText || c.richText) && !(opts.inTable && c.id === 'table'),
  )
  if (!query) return list
  return list
    .map((c, i) => ({ c, i, score: Math.max(fuzzyScore(query, c.label), ...c.keywords.map((k) => fuzzyScore(query, k))) }))
    .filter((s) => s.score > 100)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((s) => s.c)
}
