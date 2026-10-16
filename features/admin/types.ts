// Typen für den Admin-Bereich (API-Verträge zwischen Server und Browser)
import type { PublicUser } from '@/features/auth/types'

export type AdminUser = PublicUser & {
  isActive: boolean
  /** Pro Benutzer vom Admin erzwungen (unabhängig von der globalen Einstellung) */
  mfaRequiredByAdmin: boolean
  lockedUntil: number | null
  lastLoginAt: number | null
  createdAt: number
  noteCount: number
}
