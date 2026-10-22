// Tresor: Typen der API zwischen Server und Browser
import type { VaultKdf } from './format'

/** Schlüsselmaterial des Tresors – nur verpackte Schlüssel, nie der Tresor-Schlüssel selbst */
export type VaultInfo = {
  /** Wurzelordner „Tresor“ */
  folderId: string
  kdf: VaultKdf
  /** Tresor-Schlüssel, mit dem Schlüssel aus dem Passwort verpackt (AES-KW, base64url) */
  wrappedKey: string
  recoverySalt: string
  /** Tresor-Schlüssel, mit dem Schlüssel aus dem Wiederherstellungsschlüssel verpackt */
  recoveryWrappedKey: string
  /** Zählt jede Änderung am Schlüsselmaterial hoch – Grundlage der Konfliktprüfung */
  revision: number
}

/** Neues Schlüsselmaterial zum Anlegen des Tresors */
export type VaultMaterial = Omit<VaultInfo, 'folderId' | 'revision'>
