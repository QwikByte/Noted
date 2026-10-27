import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { ApiError } from '@/shared/server/http'
import type { AiModel } from '../models'

/** Client mit dem Schlüssel des Kontos – Zugangsdaten aus der Umgebung des Servers liest das SDK dann nicht */
export function claudeClient(apiKey: string) {
  return new Anthropic({ apiKey })
}

/** Prüft bei Anthropic, ob der Schlüssel gilt und das Modell nutzen darf – kostet nichts */
export async function checkAccess(apiKey: string, model: AiModel): Promise<void> {
  try {
    await claudeClient(apiKey).models.retrieve(model)
  } catch (err) {
    throw claudeError(err)
  }
}

const SETTINGS_HINT = 'unter Einstellungen → KI'

/**
 * Fehler des SDK in eine verständliche Meldung übersetzen. Nie 401: Das hieße für die App „abgemeldet“. Andere Fehler
 * werden unverändert weitergeworfen.
 */
export function claudeError(err: unknown): ApiError {
  if (!(err instanceof Anthropic.APIError)) throw err
  if (err instanceof Anthropic.APIUserAbortError) return new ApiError(499, 'aborted', 'Abgebrochen.')
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new ApiError(504, 'ai_timeout', 'Claude hat zu lange gebraucht. Versuch es noch einmal, gern mit einem Teil der Notiz.')
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new ApiError(502, 'ai_unreachable', 'Anthropic ist vom Server aus gerade nicht erreichbar.')
  }
  if (err.type === 'billing_error') {
    return new ApiError(402, 'ai_billing', 'Dein Guthaben bei Anthropic reicht nicht. Du kannst es in der Claude Console aufladen.')
  }
  if (err.type === 'overloaded_error' || err.status === 529) {
    return new ApiError(503, 'ai_overloaded', 'Claude ist gerade überlastet. Versuch es gleich noch einmal.')
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return new ApiError(400, 'ai_key_invalid', `Anthropic lehnt den API-Schlüssel ab. Prüfe ihn ${SETTINGS_HINT}.`)
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new ApiError(400, 'ai_forbidden', `Dein Schlüssel darf dieses Modell nicht nutzen. Wähle ${SETTINGS_HINT} ein anderes.`)
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new ApiError(400, 'ai_model_unavailable', `Das Modell ist für deinen Schlüssel nicht verfügbar. Wähle ${SETTINGS_HINT} ein anderes.`)
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new ApiError(429, 'ai_rate_limited', 'Anthropic meldet zu viele Anfragen für deinen Schlüssel. Versuch es in einer Minute noch einmal.')
  }
  if (err instanceof Anthropic.InternalServerError) {
    return new ApiError(502, 'ai_unavailable', 'Claude ist gerade nicht erreichbar. Versuch es gleich noch einmal.')
  }
  // Sonst hat Anthropic die Anfrage selbst abgelehnt (z. B. Schlüssel ohne Workspace) – die Meldung von dort hilft beim
  // Einordnen
  console.error('[noted] Anfrage an Claude abgelehnt', err)
  const detail = (err.error as { error?: { message?: unknown } } | undefined)?.error?.message
  const message = `Anthropic hat die Anfrage abgelehnt${typeof detail === 'string' ? `: ${detail}` : '.'}`
  return new ApiError(err.status !== undefined && err.status < 500 ? 400 : 502, 'ai_rejected', message)
}
