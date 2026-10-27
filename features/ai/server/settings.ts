import 'server-only'
import type { UserRow } from '@/features/auth/server/users'
import { audit } from '@/shared/server/audit'
import { getDb } from '@/shared/server/db'
import { decrypt, encrypt } from '@/shared/server/crypto'
import { ApiError, badRequest } from '@/shared/server/http'
import { rateLimit } from '@/shared/server/rate-limit'
import { DEFAULT_MODEL, isAiModel, type AiModel } from '../models'
import type { AiSettings } from '../types'
import { checkAccess } from './claude'

type Row = { api_key: string; key_hint: string; model: string; updated_at: number }

const getRow = (userId: number) =>
  getDb().prepare('SELECT api_key, key_hint, model, updated_at FROM ai_settings WHERE user_id = ?').get(userId) as
    | Row
    | undefined

// Ein Modell, das es in dieser Version nicht mehr zur Auswahl gibt, gilt als das Standardmodell
const modelOf = (row: Row | undefined): AiModel => (row && isAiModel(row.model) ? row.model : DEFAULT_MODEL)

export function getAiSettings(userId: number): AiSettings {
  const row = getRow(userId)
  return { configured: !!row, model: modelOf(row), keyHint: row?.key_hint ?? null, updatedAt: row?.updated_at ?? null }
}

/** Schlüssel und Modell für eine Anfrage an Claude – null, wenn das Konto keinen Schlüssel hinterlegt hat */
export function getAiCredentials(userId: number): { apiKey: string; model: AiModel } | null {
  const row = getRow(userId)
  if (!row) return null
  try {
    return { apiKey: decrypt(row.api_key), model: modelOf(row) }
  } catch (err) {
    // Etwa nach einem neuen SECRET_KEY – dann hilft nur, den Schlüssel neu zu hinterlegen
    console.error('[noted] KI-Schlüssel nicht lesbar', err)
    throw new ApiError(400, 'ai_key_unreadable', 'Der gespeicherte API-Schlüssel ist nicht mehr lesbar. Hinterleg ihn bitte neu.')
  }
}

/** Die letzten vier Zeichen zum Wiedererkennen – mehr verrät die Oberfläche nicht */
const keyHint = (apiKey: string) => `…${apiKey.slice(-4)}`

/**
 * Schlüssel und/oder Modell speichern. Ohne `apiKey` gilt der hinterlegte Schlüssel weiter. Vorher fragt der Server bei
 * Anthropic nach, ob Schlüssel und Modell zusammen funktionieren – so fällt ein Tippfehler gleich auf.
 */
export async function configureAi(
  user: UserRow,
  input: { apiKey?: string; model: AiModel },
  ip: string | null,
): Promise<AiSettings> {
  // Schützt davor, über den Server fremde Schlüssel auszuprobieren
  if (!rateLimit(`ai-key:${user.id}`, 20, 10 * 60_000).ok) {
    throw new ApiError(429, 'rate_limited', 'Zu viele Versuche. Bitte warte einen Moment.')
  }
  const apiKey = input.apiKey ?? getAiCredentials(user.id)?.apiKey
  if (!apiKey) throw badRequest('Bitte gib deinen API-Schlüssel ein.')
  await checkAccess(apiKey, input.model)
  getDb()
    .prepare(
      `INSERT INTO ai_settings (user_id, api_key, key_hint, model, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET api_key = excluded.api_key, key_hint = excluded.key_hint,
         model = excluded.model, updated_at = excluded.updated_at`,
    )
    .run(user.id, encrypt(apiKey), keyHint(apiKey), input.model, Date.now())
  if (input.apiKey) audit({ event: 'ai_key_saved', userId: user.id, username: user.username, ip })
  return getAiSettings(user.id)
}

/** Schlüssel entfernen – danach ist die KI für das Konto aus */
export function removeAi(user: UserRow, ip: string | null): AiSettings {
  const removed = getDb().prepare('DELETE FROM ai_settings WHERE user_id = ?').run(user.id).changes > 0
  if (removed) audit({ event: 'ai_key_removed', userId: user.id, username: user.username, ip })
  return getAiSettings(user.id)
}
