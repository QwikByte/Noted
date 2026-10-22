// Grenzen des Tresors – prüfen Server und Browser.
import { envelopeLength } from './format'

/** Mindestlänge des Tresor-Passworts (Hinweis in der Oberfläche: ein Satz aus mehreren Wörtern) */
export const MIN_VAULT_PASSWORD_LENGTH = 12
/** Klartext einer Tresor-Notiz (UTF-8) – der Umschlag (~4 MB) bleibt so unter der Grenze von parseJson (5 MB) */
const MAX_VAULT_NOTE_BYTES = 3_000_000
export const MAX_VAULT_ENVELOPE_LENGTH = envelopeLength(MAX_VAULT_NOTE_BYTES)
/** Titel und Ordnernamen haben höchstens 200 Zeichen, also höchstens 600 Bytes UTF-8 */
export const MAX_VAULT_TITLE_ENVELOPE_LENGTH = envelopeLength(600)
