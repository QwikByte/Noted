'use client'
import type { Insertion } from './active-editor'
import type { Attachment } from '@/features/attachments/types'

/** Was die Notizansicht mit dem Editor des jeweiligen Formats tun kann */
export type NoteEditorHandle = {
  focus: () => void
  /** Inhalt komplett ersetzen, ohne ihn als Änderung zu speichern (z. B. neuerer Stand vom Server) */
  setDoc: (doc: string) => void
  /** Seitenlink oder Zitat aus dem PDF-Viewer als eigenen Absatz einfügen */
  insert: (insertion: Insertion) => void
  /** Hochgeladenen Anhang an der Cursorposition einfügen */
  insertAttachment: (att: Attachment) => void
  /** Markierter Text, z. B. für eine Karteikarte */
  selectedText: () => string
}

/** Formatierter Text: zusätzlich zur n-ten Überschrift springen (für die Gliederung) */
export type RichTextHandle = NoteEditorHandle & {
  /** Cursor in die Überschrift und sie oben zeigen; mit `focus` (Auswahl per Tastatur) auch den Fokus */
  revealHeading: (index: number, focus: boolean) => void
}
