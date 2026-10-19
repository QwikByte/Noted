// Typen für Notizen und Ordner (API-Verträge zwischen Server und Browser)
import type { FileSearchResult } from '@/features/attachments/types'

export type Folder = {
  id: string
  parentId: string | null
  name: string
  createdAt: number
  updatedAt: number
}

/**
 * markdown: Markdown mit Wikilinks · richtext: formatierter Text (HTML aus dem Editor) · text: einfacher Text ·
 * mindmap: Markdown-Gliederung, als Mindmap bearbeitet · canvas: JSON Canvas
 */
export type NoteFormat = 'markdown' | 'richtext' | 'text' | 'mindmap' | 'canvas'

export type NoteSummary = {
  id: string
  folderId: string | null
  title: string
  format: NoteFormat
  pinned: boolean
  version: number
  createdAt: number
  updatedAt: number
  tags: string[]
  excerpt: string
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
  format: NoteFormat
  reason: NoteVersionReason
  createdAt: number
  size: number
}

export type NoteVersionWithContent = NoteVersion & { content: string }
