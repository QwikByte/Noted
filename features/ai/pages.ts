// Seitenauswahl wie beim Drucken: „3“, „3–5, 8“ – für Karten aus PDF-Seiten.
import { MAX_AI_PDF_PAGES } from './limits'

/** „3–5, 8“ → [3, 4, 5, 8] – oder eine Fehlermeldung. `count`: Seiten des PDFs. */
export function parsePageList(input: string, count: number): number[] | string {
  const pages = new Set<number>()
  const parts = input.split(/[,;\s]+/).filter(Boolean)
  if (parts.length === 0) return 'Gib an, welche Seiten Claude lesen soll, z. B. „3–5, 8“.'
  for (const part of parts) {
    const m = /^(\d+)(?:[-–—](\d+))?$/.exec(part)
    if (!m) return `„${part}“ ist keine Seite. Schreib z. B. „3–5, 8“.`
    const from = Number(m[1])
    const to = m[2] ? Number(m[2]) : from
    if (from < 1 || to > count || from > to) return `Das PDF hat die Seiten 1 bis ${count}.`
    if (to - from >= MAX_AI_PDF_PAGES) return `Höchstens ${MAX_AI_PDF_PAGES} Seiten auf einmal.`
    for (let p = from; p <= to; p++) pages.add(p)
  }
  if (pages.size > MAX_AI_PDF_PAGES) return `Höchstens ${MAX_AI_PDF_PAGES} Seiten auf einmal.`
  return [...pages].sort((a, b) => a - b)
}

/** [3, 4, 5, 8] → „3–5, 8“ */
export function formatPageList(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b)
  const out: string[] = []
  for (let i = 0; i < sorted.length; i++) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++
    out.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]))
    i = j
  }
  return out.join(', ')
}
