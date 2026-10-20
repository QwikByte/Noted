// Grenzen für geteilte Links – gelten für Server und Browser

import type { ShareExpiry } from './types'

/** Wählbare Laufzeiten (Tage, null = unbegrenzt) */
export const SHARE_EXPIRY_DAYS: readonly ShareExpiry[] = [7, 30, null]

/** Aufrufe je IP und Minute auf geteilte Links (Seite, Inhalt und Dateien zusammen) – bremst das Raten von Tokens */
export const SHARE_RATE_LIMIT = 60
export const SHARE_RATE_WINDOW_MS = 60_000
