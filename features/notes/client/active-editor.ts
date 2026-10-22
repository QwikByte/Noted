'use client'
// Verbindung zwischen PDF-Viewer und Schmierzettel und der gerade geöffneten Notiz: Seitenlinks und Zitate aus dem PDF
// sowie Text vom Schmierzettel landen an der Cursorposition im Editor – im Format der Notiz.

/** Stelle in einem PDF-Anhang */
export type PdfRef = { file: string; page: number }

/** Zitat aus einem PDF samt Stelle */
export type PdfQuote = { text: string; ref: PdfRef }

/**
 * Was PDF-Viewer und Schmierzettel in eine Notiz einfügen – „quotes“: mehrere Zitate auf einmal (z. B. alle
 * Anmerkungen), „text“: einfacher Text vom Schmierzettel
 */
export type Insertion =
  | { kind: 'page-link'; ref: PdfRef }
  | ({ kind: 'quote' } & PdfQuote)
  | { kind: 'quotes'; quotes: PdfQuote[] }
  | { kind: 'text'; text: string }

type ActiveEditor = {
  noteId: string
  title: string
  /** Fügt den Inhalt als eigenen Absatz an der Cursorposition (bzw. am Ende) ein */
  insert: (insertion: Insertion) => void
}

let active: ActiveEditor | null = null

export function registerActiveEditor(editor: ActiveEditor): () => void {
  active = editor
  return () => {
    if (active === editor) active = null
  }
}

export function getActiveEditor(): ActiveEditor | null {
  return active
}

/** Seitenlink als Wikilink, z. B. [[Skript.pdf#page=12|S. 12]] */
export function pdfPageLink(ref: PdfRef, label?: string): string {
  return `[[${ref.file}#page=${ref.page}${label ? `|${label}` : ''}]]`
}

const quoteMarkdown = ({ text, ref }: PdfQuote) =>
  [...text.split('\n').map((l) => `> ${l}`), `> ${pdfPageLink(ref, `S. ${ref.page}`)}`].join('\n')

/** Einfügen in Markdown und einfachen Text */
export function insertionToMarkdown(insertion: Insertion): string {
  if (insertion.kind === 'text') return insertion.text
  if (insertion.kind === 'page-link') return pdfPageLink(insertion.ref)
  if (insertion.kind === 'quotes') return insertion.quotes.map(quoteMarkdown).join('\n\n')
  return quoteMarkdown(insertion)
}
