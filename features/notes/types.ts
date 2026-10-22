// Typen für Notizen und Ordner (API-Verträge zwischen Server und Browser)
import type { FileSearchResult } from '@/features/attachments/types'

export type Folder = {
  id: string
  parentId: string | null
  /** Im Tresor: Platzhalter (die ID), der echte Name steht verschlüsselt in `nameEnc` – außer beim Wurzelordner */
  name: string
  createdAt: number
  updatedAt: number
  /** Gehört zum Tresor (Wurzelordner „Tresor“ und alle Unterordner) */
  vault: boolean
  nameEnc: string | null
}

/**
 * markdown: Markdown mit Wikilinks · richtext: formatierter Text (HTML aus dem Editor) · text: einfacher Text ·
 * mindmap: Markdown-Gliederung, als Mindmap bearbeitet · canvas: JSON Canvas
 */
export type NoteFormat = 'markdown' | 'richtext' | 'text' | 'mindmap' | 'canvas'

export type NoteSummary = {
  id: string
  folderId: string | null
  /** Im Tresor: Platzhalter (die ID), der echte Titel steht verschlüsselt in `titleEnc` */
  title: string
  format: NoteFormat
  pinned: boolean
  version: number
  createdAt: number
  updatedAt: number
  tags: string[]
  excerpt: string
  /** Im Tresor: Titel und Inhalt sind Umschläge, die nur der entsperrte Browser öffnet */
  vault: boolean
  titleEnc: string | null
}

export type Note = NoteSummary & {
  content: string
}

export type TrashedNote = {
  id: string
  title: string
  folderId: string | null
  deletedAt: number
  updatedAt: number
  vault: boolean
  titleEnc: string | null
}

export type SearchResult = {
  id: string
  title: string
  folderId: string | null
  snippet: string
  updatedAt: number
}

/** Antwort der Suche: Notizen und Treffer in Dateien (#tag-Filter gelten nur für Notizen) */
export type SearchResponse = { results: SearchResult[]; files: FileSearchResult[] }

export type TagCount = { tag: string; count: number }

/** Sammelaktionen für mehrere Notizen auf einmal (POST /api/notes/batch) */
export const NOTE_BATCH_ACTIONS = ['trash', 'restore', 'delete', 'pin', 'unpin'] as const
export type NoteBatchAction = (typeof NOTE_BATCH_ACTIONS)[number]
/** Die tatsächlich geänderten Notizen, in der Reihenfolge der Anfrage */
export type NoteBatchResult = { ids: string[] }

/**
 * Anlass, zu dem ein älterer Stand gesichert wurde: edit – Bearbeiten nach einer Pause · conflict – vor dem
 * Überschreiben bei einem Konflikt · restore – vor dem Wiederherstellen · format – vor einem Formatwechsel
 */
export type NoteVersionReason = 'edit' | 'conflict' | 'restore' | 'format'

/** Gesicherter Stand einer Notiz (ohne Inhalt, für die Liste) – size: Größe des Inhalts in Bytes */
export type NoteVersion = {
  id: number
  version: number
  title: string
  /** Bei Tresor-Notizen der verschlüsselte Titel dieses Stands */
  titleEnc: string | null
  format: NoteFormat
  reason: NoteVersionReason
  createdAt: number
  size: number
}

export type NoteVersionWithContent = NoteVersion & { content: string }
