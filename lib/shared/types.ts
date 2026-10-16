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

// ---- Karteikarten ----

/** basic: Vorderseite → Rückseite · reversed: zusätzlich Rückseite → Vorderseite · mc: Multiple Choice */
export type CardType = 'basic' | 'reversed' | 'mc'

export type CardOption = { text: string; correct: boolean }

export type Deck = {
  id: string
  name: string
  description: string
  /** Höchstens so viele neue Karten pro Tag im Lernmodus */
  newPerDay: number
  createdAt: number
  updatedAt: number
}

export type Card = {
  id: string
  deckId: string
  /** Notiz, aus der die Karte stammt (optional) */
  noteId: string | null
  type: CardType
  front: string
  /** Antwort – bei Multiple Choice die (optionale) Erklärung */
  back: string
  options: CardOption[]
  position: number
  createdAt: number
  updatedAt: number
}

export type CardPhase = 'learning' | 'review' | 'relearning'

/** Lernstand einer Kartenseite (Wiederholungsplan) */
export type SrsState = {
  phase: CardPhase
  /** Lernschritt (nur in den Lernphasen) */
  step: number
  /** Abstand in Tagen (in der Lernphase: 0; beim Wiederlernen: Abstand nach dem Wiederlernen) */
  interval: number
  ease: number
  reps: number
  lapses: number
  due: number
  reviewedAt: number
  /** Zeitpunkt der ersten Abfrage (für das Tageslimit neuer Karten) */
  introducedAt: number
}

/** side 0: Vorderseite wird abgefragt, side 1: Rückseite (nur bei beidseitigen Karten) */
export type CardReview = SrsState & { cardId: string; side: 0 | 1 }

export type FlashcardData = { decks: Deck[]; cards: Card[]; reviews: CardReview[] }

/** Zustand des Server-Updates laut scripts/auto-update.sh (.update/status) */
export type UpdateRunState = 'ok' | 'updating' | 'failed' | 'rolled_back' | 'error' | 'unknown'

export type UpdateStatus =
  | { configured: false }
  | {
      configured: true
      state: UpdateRunState
      checkedAt: number | null
      /** vom Skript installiertes Release */
      current: string | null
      /** neuestes Release im Repository */
      latest: string | null
      updatedAt: number | null
      failedTag: string | null
      failedAt: number | null
      failedStage: 'build' | 'deploy' | null
      message: string | null
      /** Ende des Protokolls des letzten Update-Laufs */
      log: string | null
    }

/** Vom Admin-Bereich angestoßene, noch nicht abgeholte Update-Prüfung */
export type UpdateRequest = { at: number | null; retry: boolean; by: string | null }

export type SystemInfo = {
  version: string
  commit: string
  buildDate: string
  node: string
  update: UpdateStatus
  /** Kann der Admin-Bereich ein Update anstoßen? (Anfrage-Ordner vorhanden und beschreibbar) */
  canRequestUpdate: boolean
  updateRequest: UpdateRequest | null
}
