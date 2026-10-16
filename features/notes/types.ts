// Typen für Notizen und Ordner (API-Verträge zwischen Server und Browser)

export type Folder = {
  id: string
  parentId: string | null
  name: string
  createdAt: number
  updatedAt: number
}

export type NoteSummary = {
  id: string
  folderId: string | null
  title: string
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
