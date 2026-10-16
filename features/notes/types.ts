// Typen für Notizen und Ordner (API-Verträge zwischen Server und Browser)

export type Folder = {
  id: string
  parentId: string | null
  name: string
  createdAt: number
  updatedAt: number
}

/**
 * markdown: Obsidian-Markdown · richtext: formatierter Text (HTML aus dem Editor) · text: einfacher Text ·
 * mindmap: Markdown-Gliederung, als Mindmap bearbeitet · canvas: JSON Canvas (wie Obsidian Canvas)
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

export type TagCount = { tag: string; count: number }
