// Gemeinsame Typen für Server und Client (API-Verträge)

export type Role = 'admin' | 'user'

export type PublicUser = {
  id: number
  username: string
  displayName: string
  role: Role
  mfaEnabled: boolean
  /** MFA muss eingerichtet sein (durch Admin oder globale Einstellung) */
  mfaRequired: boolean
  mustChangePassword: boolean
}

export type AdminUser = PublicUser & {
  isActive: boolean
  /** Pro Benutzer vom Admin erzwungen (unabhängig von der globalen Einstellung) */
  mfaRequiredByAdmin: boolean
  lockedUntil: number | null
  lastLoginAt: number | null
  createdAt: number
  noteCount: number
}

export type SessionInfo = {
  id: string
  createdAt: number
  lastSeenAt: number
  ip: string | null
  userAgent: string | null
  current: boolean
}

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

export type Attachment = {
  id: string
  filename: string
  mime: string
  size: number
  createdAt: number
}

export type ApiErrorBody = {
  error: string
  message: string
  [key: string]: unknown
}
