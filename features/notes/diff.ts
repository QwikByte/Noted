// Zeilenweiser Vergleich zweier Texte (Myers-Algorithmus) – für den Verlauf und den Konflikt zweier Fassungen.
// Gemeinsamer Anfang und gemeinsames Ende werden vorab abgeschnitten: Wenige Änderungen in einer langen Notiz
// kosten so fast nichts. Sehr große Unterschiede brechen ab, statt den Tab zu blockieren.

export type DiffPart = { kind: 'same' | 'added' | 'removed'; lines: string[] }

/** Für die Anzeige: unveränderte Bereiche gekürzt auf „… n unveränderte Zeilen“ */
export type DiffRow = { kind: 'same' | 'added' | 'removed'; text: string } | { kind: 'skip'; count: number }

/** Höchstens so viele Zeilen je Seite nach dem Abschneiden von Anfang und Ende */
const MAX_LINES = 20_000
/** Höchstens so viele eingefügte oder gelöschte Zeilen – darüber wird der Vergleich zu teuer */
const MAX_EDITS = 1_000

type Edit = 'same' | 'added' | 'removed'

/**
 * Kürzester Weg durch das Editiergitter (Myers 1986). Je Schritt wird nur der Teil von V gemerkt, der für den
 * Rückweg nötig ist – der Speicher wächst mit dem Quadrat der Änderungen, nicht mit der Länge der Texte.
 */
function myers(a: number[], b: number[]): Edit[] | null {
  const n = a.length
  const m = b.length
  const offset = n + m + 1
  const v = new Int32Array(2 * offset + 1)
  const trace: Int32Array[] = []
  for (let d = 0; d <= Math.min(n + m, MAX_EDITS); d++) {
    trace.push(v.slice(offset - d, offset + d + 1))
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[offset + k] = x
      if (x >= n && y >= m) return backtrack(trace, n, m)
    }
  }
  return null
}

function backtrack(trace: Int32Array[], n: number, m: number): Edit[] {
  const edits: Edit[] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d > 0; d--) {
    const vd = trace[d]
    const at = (k: number) => vd[k + d]
    const k = x - y
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1
    const prevX = at(prevK)
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      edits.push('same')
      x--
      y--
    }
    edits.push(x === prevX ? 'added' : 'removed')
    x = prevX
    y = prevY
  }
  while (x > 0 && y > 0) {
    edits.push('same')
    x--
    y--
  }
  return edits.reverse()
}

const splitLines = (text: string) => (text === '' ? [] : text.replace(/\r\n?/g, '\n').split('\n'))

/** Unterschiede zwischen `a` (vorher) und `b` (nachher) – null, wenn sie zu groß für einen Vergleich sind */
export function diffLines(a: string, b: string): DiffPart[] | null {
  const left = splitLines(a)
  const right = splitLines(b)
  let start = 0
  while (start < left.length && start < right.length && left[start] === right[start]) start++
  let end = 0
  while (end < left.length - start && end < right.length - start && left[left.length - 1 - end] === right[right.length - 1 - end]) end++
  const midA = left.slice(start, left.length - end)
  const midB = right.slice(start, right.length - end)
  if (midA.length > MAX_LINES || midB.length > MAX_LINES) return null
  // Zahlen statt Zeichenketten vergleichen
  const ids = new Map<string, number>()
  const id = (line: string) => ids.get(line) ?? (ids.set(line, ids.size), ids.size - 1)
  const edits = myers(midA.map(id), midB.map(id))
  if (!edits) return null

  const parts: DiffPart[] = []
  const push = (kind: Edit, line: string) => {
    const last = parts[parts.length - 1]
    if (last?.kind === kind) last.lines.push(line)
    else parts.push({ kind, lines: [line] })
  }
  for (const line of left.slice(0, start)) push('same', line)
  let i = 0
  let j = 0
  for (const e of edits) {
    if (e === 'same') {
      push('same', midA[i++])
      j++
    } else if (e === 'removed') push('removed', midA[i++])
    else push('added', midB[j++])
  }
  for (const line of left.slice(left.length - end)) push('same', line)
  return parts
}

/** Zeilen für die Anzeige – von unveränderten Bereichen nur `context` Zeilen am Rand einer Änderung */
export function diffRows(parts: DiffPart[], context = 3): DiffRow[] {
  const rows: DiffRow[] = []
  parts.forEach((part, index) => {
    if (part.kind !== 'same') {
      for (const text of part.lines) rows.push({ kind: part.kind, text })
      return
    }
    const before = index > 0 ? context : 0
    const after = index < parts.length - 1 ? context : 0
    if (part.lines.length <= before + after + 1) {
      for (const text of part.lines) rows.push({ kind: 'same', text })
      return
    }
    for (const text of part.lines.slice(0, before)) rows.push({ kind: 'same', text })
    rows.push({ kind: 'skip', count: part.lines.length - before - after })
    for (const text of part.lines.slice(part.lines.length - after)) rows.push({ kind: 'same', text })
  })
  return rows
}
