// Markdown-Tabellen (GFM) im Editor bearbeiten: erkennen, Zellen trennen, ausrichten, Zeilen und Spalten einfügen
// oder löschen. Zellen trennt jedes „|“ außer „\|“ – wie markdown-it im Lesemodus, das auch in `Code` und $Formeln$
// trennt.

export type Align = 'none' | 'left' | 'center' | 'right'

export type Table = {
  /** Kopfzeile zuerst, ohne die Trennzeile */
  rows: string[][]
  align: Align[]
  /** Erste und letzte Zeile im Text (0-basiert) */
  from: number
  to: number
  /** Einrückung der ersten Zeile – bleibt für alle Zeilen */
  indent: string
}

/** Zelle in der Tabelle: Zeile 0 ist der Kopf (die Trennzeile zählt zu ihm), Spalte ab 0 */
export type Cell = { row: number; col: number }

type Span = { text: string; from: number; to: number }

const DELIMITER_CELL = /^:?-+:?$/

/** Zellen einer Zeile samt Stelle – null ohne „|“ */
function cellsOf(line: string): Span[] | null {
  const seps: number[] = []
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\') i++
    else if (line[i] === '|') seps.push(i)
  }
  if (seps.length === 0) return null
  const start = line.length - line.trimStart().length
  const end = line.trimEnd().length
  const lead = seps[0] === start
  const trail = seps[seps.length - 1] === end - 1 && (seps.length > 1 || !lead)
  const bounds = [lead ? seps[0] + 1 : start, ...seps.slice(lead ? 1 : 0, trail ? -1 : undefined).map((s) => s + 1)]
  const spans: Span[] = []
  for (let i = 0; i < bounds.length; i++) {
    const from = bounds[i]
    const to = i + 1 < bounds.length ? bounds[i + 1] - 1 : trail ? seps[seps.length - 1] : end
    spans.push({ text: line.slice(from, to).trim(), from, to })
  }
  return spans
}

/** Tabellenzeile: enthält ein „|“, das nicht mit „\“ maskiert ist – auch das Menü „/“ bleibt dort zu */
export const isTableRow = (line: string) => line.trim() !== '' && cellsOf(line) !== null

function isDelimiterRow(line: string): boolean {
  const cells = cellsOf(line)
  return !!cells && cells.every((c) => DELIMITER_CELL.test(c.text))
}

function alignOf(cell: string): Align {
  const left = cell.startsWith(':')
  const right = cell.endsWith(':')
  return left && right ? 'center' : left ? 'left' : right ? 'right' : 'none'
}

/**
 * Die Tabelle, zu der Zeile `index` gehört – null außerhalb einer Tabelle. `line(i)` liefert die Zeile i (0-basiert)
 * oder undefined; so reicht ein Blick auf die Zeilen um den Cursor statt des ganzen Texts.
 */
export function parseTableAt(line: (i: number) => string | undefined, index: number): Table | null {
  const isRow = (i: number) => {
    const text = line(i)
    return text !== undefined && isTableRow(text)
  }
  if (!isRow(index)) return null
  let start = index
  while (isRow(start - 1)) start--
  let end = index
  while (isRow(end + 1)) end++
  // Der Kopf steht direkt über der Trennzeile
  let head = -1
  for (let i = start; i < end; i++) {
    if (isDelimiterRow(line(i + 1)!)) {
      head = i
      break
    }
  }
  if (head < 0 || index < head) return null
  const header = cellsOf(line(head)!)!.map((c) => c.text)
  const delimiter = cellsOf(line(head + 1)!)!.map((c) => c.text)
  const body: string[][] = []
  for (let i = head + 2; i <= end; i++) body.push(cellsOf(line(i)!)!.map((c) => c.text))
  const text = line(head)!
  return {
    rows: [header, ...body],
    align: delimiter.map(alignOf),
    from: head,
    to: end,
    indent: text.slice(0, text.length - text.trimStart().length),
  }
}

/** Zelle an Spalte `ch` (Zeichen in der Zeile) der Textzeile `index` */
export function cellAt(table: Table, index: number, ch: number, line: string): Cell {
  const row = index <= table.from + 1 ? 0 : index - table.from - 1
  const spans = cellsOf(line) ?? []
  let col = spans.findIndex((s) => ch <= s.to)
  if (col < 0) col = Math.max(0, spans.length - 1)
  return { row, col }
}

const width = (s: string) => [...s].length
const columns = (t: Table) => Math.max(1, t.align.length, ...t.rows.map((r) => r.length))

function widths(t: Table): number[] {
  return Array.from({ length: columns(t) }, (_, c) => Math.max(3, ...t.rows.map((r) => width(r[c] ?? ''))))
}

function pad(text: string, w: number, align: Align): string {
  const space = w - width(text)
  if (align === 'right') return ' '.repeat(space) + text
  if (align === 'center') return ' '.repeat(Math.floor(space / 2)) + text + ' '.repeat(Math.ceil(space / 2))
  return text + ' '.repeat(space)
}

function delimiter(w: number, align: Align): string {
  if (align === 'center') return ':' + '-'.repeat(w - 2) + ':'
  if (align === 'left') return ':' + '-'.repeat(w - 1)
  if (align === 'right') return '-'.repeat(w - 1) + ':'
  return '-'.repeat(w)
}

/** Tabelle als Text: Spalten gleich breit, Ausrichtung in der Trennzeile, „|“ an beiden Enden. Fehlende Zellen leer. */
export function formatTable(t: Table): string {
  const ws = widths(t)
  const align = (c: number) => t.align[c] ?? 'none'
  const line = (cells: string[]) => `${t.indent}| ${cells.join(' | ')} |`
  const row = (r: string[]) => line(ws.map((w, c) => pad(r[c] ?? '', w, align(c))))
  return [row(t.rows[0]), line(ws.map((w, c) => delimiter(w, align(c)))), ...t.rows.slice(1).map(row)].join('\n')
}

/** Stelle hinter dem Inhalt der Zelle im Text von formatTable – Zeile relativ zum Tabellenanfang */
export function cellEnd(t: Table, cell: Cell): { line: number; ch: number } {
  const ws = widths(t)
  const col = Math.min(cell.col, ws.length - 1)
  let ch = t.indent.length + 2
  for (let c = 0; c < col; c++) ch += ws[c] + 3
  const text = t.rows[cell.row]?.[col] ?? ''
  const align = t.align[col] ?? 'none'
  const before = align === 'right' ? ws[col] - width(text) : align === 'center' ? Math.floor((ws[col] - width(text)) / 2) : 0
  return { line: cell.row === 0 ? 0 : cell.row + 1, ch: ch + before + text.length }
}

const emptyRow = (t: Table) => Array.from({ length: columns(t) }, () => '')

/** Nächste bzw. vorige Zelle (Tab, Umschalt+Tab) – hinter der letzten Zelle kommt eine neue Zeile dazu */
export function moveCell(t: Table, cell: Cell, step: 1 | -1): { table: Table; cell: Cell } {
  const cols = columns(t)
  let { row, col } = cell
  col += step
  if (col >= cols) {
    row++
    col = 0
  } else if (col < 0) {
    if (row === 0) return { table: t, cell: { row: 0, col: 0 } }
    row--
    col = cols - 1
  }
  if (row >= t.rows.length) return { table: { ...t, rows: [...t.rows, emptyRow(t)] }, cell: { row, col } }
  return { table: t, cell: { row, col } }
}

/** Leere Zeile über (`below` false) oder unter der Zelle – über dem Kopf geht nicht, dann direkt darunter */
export function insertRow(t: Table, cell: Cell, below: boolean): { table: Table; cell: Cell } {
  const at = below || cell.row === 0 ? cell.row + 1 : cell.row
  const rows = [...t.rows.slice(0, at), emptyRow(t), ...t.rows.slice(at)]
  return { table: { ...t, rows }, cell: { row: at, col: cell.col } }
}

/** Zeile löschen – nicht den Kopf */
export function deleteRow(t: Table, cell: Cell): { table: Table; cell: Cell } {
  if (cell.row === 0) return { table: t, cell }
  const rows = t.rows.filter((_, i) => i !== cell.row)
  return { table: { ...t, rows }, cell: { row: Math.min(cell.row, rows.length - 1), col: cell.col } }
}

export function insertColumn(t: Table, cell: Cell, right: boolean): { table: Table; cell: Cell } {
  const at = right ? cell.col + 1 : cell.col
  const cols = columns(t)
  const fill = (r: string[]) => Array.from({ length: cols }, (_, c) => r[c] ?? '')
  const rows = t.rows.map((r) => {
    const full = fill(r)
    return [...full.slice(0, at), '', ...full.slice(at)]
  })
  const align = Array.from({ length: cols }, (_, c) => t.align[c] ?? 'none')
  return { table: { ...t, rows, align: [...align.slice(0, at), 'none', ...align.slice(at)] }, cell: { row: cell.row, col: at } }
}

/** Spalte löschen – die letzte bleibt */
export function deleteColumn(t: Table, cell: Cell): { table: Table; cell: Cell } {
  if (columns(t) <= 1) return { table: t, cell }
  const rows = t.rows.map((r) => r.filter((_, c) => c !== cell.col))
  const align = t.align.filter((_, c) => c !== cell.col)
  return { table: { ...t, rows, align }, cell: { row: cell.row, col: Math.min(cell.col, columns(t) - 2) } }
}

export function setAlignment(t: Table, cell: Cell, value: Align): { table: Table; cell: Cell } {
  const align = Array.from({ length: columns(t) }, (_, c) => (c === cell.col ? value : (t.align[c] ?? 'none')))
  return { table: { ...t, align }, cell }
}
