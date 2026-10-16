// Typen für Anmeldung und Konten (API-Verträge zwischen Server und Browser)

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

export type SessionInfo = {
  id: string
  createdAt: number
  lastSeenAt: number
  ip: string | null
  userAgent: string | null
  current: boolean
}
