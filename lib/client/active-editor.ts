'use client'
// Verbindung zwischen PDF-Viewer und der gerade geöffneten Notiz: Seitenlinks und Zitate aus dem PDF landen
// an der Cursorposition im Editor.

export type ActiveEditor = {
  noteId: string
  title: string
  /** Fügt Text als eigenen Absatz an der Cursorposition (bzw. am Ende) ein */
  insert: (text: string) => void
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
