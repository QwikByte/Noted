'use client'
import type { Insertion } from './active-editor'
import type { Attachment } from '@/features/attachments/types'

/**
 * Markierter Abschnitt für den KI-Assistenten: der Text als Markdown und seine Stelle. `check` ist der Text, wie er beim
 * Öffnen dort stand – hat er sich bis zum Übernehmen geändert, wird nichts ersetzt.
 */
export type AiSpan = { from: number; to: number; markdown: string; check: string }

/** Was die Notizansicht mit dem Editor des jeweiligen Formats tun kann */
export type NoteEditorHandle = {
  focus: () => void
  /**
   * Stand von außen übernehmen (anderes Gerät, Konflikt, Wiederherstellen): nicht als Änderung gespeichert und nicht
   * per Rückgängig zurückzuholen
   */
  setDoc: (doc: string) => void
  /** Seitenlink oder Zitat aus dem PDF-Viewer bzw. Text vom Schmierzettel als eigenen Absatz einfügen */
  insert: (insertion: Insertion) => void
  /** Hochgeladenen Anhang an der Cursorposition einfügen */
  insertAttachment: (att: Attachment) => void
  /** Markierter Text, z. B. für eine Karteikarte */
  selectedText: () => string
  /** Markierung für den KI-Assistenten – null ohne Markierung (nur in Markdown, einfachem und formatiertem Text) */
  aiSelection?: () => AiSpan | null
  /**
   * Ergebnis des KI-Assistenten anstelle der Markierung bzw. dahinter einsetzen, mit Strg+Z rückgängig zu machen –
   * false, wenn sich der Text an der Stelle inzwischen geändert hat
   */
  applyAi?: (span: AiSpan, markdown: string, how: 'replace' | 'after') => boolean
}

/** Formatierter Text: zusätzlich zur n-ten Überschrift springen (für die Gliederung) */
export type RichTextHandle = NoteEditorHandle & {
  /** Cursor in die Überschrift und sie oben zeigen; mit `focus` (Auswahl per Tastatur) auch den Fokus */
  revealHeading: (index: number, focus: boolean) => void
  /** Inhalt ersetzen, den der Aufrufer selbst speichert (z. B. Ergebnis des KI-Assistenten) – mit Strg+Z rückgängig */
  replaceDoc: (html: string) => void
}
