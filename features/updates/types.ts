// Typen für Version und automatische Updates (API-Verträge zwischen Server und Browser)

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
