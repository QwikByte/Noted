// Typen für geteilte Links (API-Verträge zwischen Server und Browser)
import type { NoteFormat } from '@/features/notes/types'

/** Laufzeit eines Links in Tagen – null = unbegrenzt */
export type ShareExpiry = 7 | 30 | null

/** Freigabe einer Notiz – ohne Token: Den Link gibt es nur einmal beim Erstellen */
export type Share = {
  id: string
  noteId: string
  noteTitle: string
  createdAt: number
  expiresAt: number | null
  lastOpenedAt: number | null
  opens: number
  /** Die Notiz liegt im Papierkorb – der Link funktioniert erst nach dem Wiederherstellen wieder */
  noteTrashed: boolean
}

/** Was Gäste über einen Link sehen */
export type SharedNote = { title: string; format: NoteFormat; content: string; updatedAt: number }
