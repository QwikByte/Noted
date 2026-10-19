'use client'
// Verbindung zwischen PDF-Viewer und der gerade geöffneten Notiz: Seitenlinks und Zitate aus dem PDF landen
// an der Cursorposition im Editor – im Format der Notiz.

/** Stelle in einem PDF-Anhang */
export type PdfRef = { file: string; page: number }

/** Was der PDF-Viewer in eine Notiz einfügt */
export type Insertion = { kind: 'page-link'; ref: PdfRef } | { kind: 'quote'; text: string; ref: PdfRef }

export type ActiveEditor = {
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

/** Einfügen in Markdown und einfachen Text */
export function insertionToMarkdown(insertion: Insertion): string {
  if (insertion.kind === 'page-link') return pdfPageLink(insertion.ref)
  const { text, ref } = insertion
  return [...text.split('\n').map((l) => `> ${l}`), `> ${pdfPageLink(ref, `S. ${ref.page}`)}`].join('\n')
}
