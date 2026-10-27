import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import type { BetaContentBlockParam, BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages'
import { ApiError } from '@/shared/server/http'
import type { AiModel } from '../models'
import type { Prompt } from '../prompt'

type Credentials = { apiKey: string; model: AiModel }

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

/** Für Haiku gibt es keinen Fallback auf ein anderes Modell */
const NO_FALLBACK: AiModel[] = ['claude-haiku-5-5']

/** Lehnt das Modell eine Anfrage aus Sicherheitsgründen ab, versucht Anthropic sie mit einem anderen (außer bei Haiku) */
export const fallbackParams = (model: AiModel) =>
  NO_FALLBACK.includes(model) ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }

/** Text und Bilder der Anfrage als Inhaltsblöcke der API */
export function contentBlocks(prompt: Prompt): BetaContentBlockParam[] {
  return prompt.parts.map((p) =>
    p.kind === 'text'
      ? { type: 'text', text: p.text }
      : { type: 'image', source: { type: 'base64', media_type: p.image.mediaType, data: p.image.data } },
  )
}

export const refusedError = () =>
  new ApiError(
    422,
    'ai_refused',
    'Claude hat die Anfrage abgelehnt. Das kommt selten auch bei harmlosen Themen vor – versuch es mit einem anderen Modell oder einem Teil des Inhalts.',
  )

/**
 * Anfrage mit strukturierter Ausgabe (JSON nach `schema`). Liefert den Text des Modells, das zuletzt geschrieben hat –
 * nach einem Fallback nicht den abgebrochenen Anfang des ersten. Ablehnung und Längengrenze werden zu Fehlern.
 */
export async function structured(
  { apiKey, model }: Credentials,
  prompt: Prompt,
  opts: { schema: Record<string, unknown>; maxTokens: number; effort: 'low' | 'medium'; tooLong: string },
  signal?: AbortSignal,
): Promise<string | undefined> {
  let message: BetaMessage
  try {
    // Gestreamt, damit lange Antworten nicht an Zeitlimits der Verbindung scheitern
    const stream = claudeClient(apiKey).beta.messages.stream(
      {
        model,
        max_tokens: opts.maxTokens,
        system: prompt.system,
        messages: [{ role: 'user', content: contentBlocks(prompt) }],
        // Bewusst ohne Parser des SDK: Der läse jeden Textblock als JSON – auch den abgebrochenen Anfang einer Antwort,
        // die nach einer Ablehnung ein anderes Modell neu geschrieben hat
        output_config: { effort: opts.effort, format: { type: 'json_schema', schema: opts.schema } },
        ...fallbackParams(model),
      },
      { signal },
    )
    message = await stream.finalMessage()
  } catch (err) {
    throw claudeError(err)
  }
  if (message.stop_reason === 'refusal') throw refusedError()
  if (message.stop_reason === 'max_tokens') throw new ApiError(422, 'ai_too_long', opts.tooLong)
  return message.content.findLast((b) => b.type === 'text')?.text
}

/** Antwort, die nicht ins verlangte Format passt – kommt praktisch nur bei Störungen vor */
export function invalidAnswer(what: string): ApiError {
  console.error('[noted] Unerwartete Antwort von Claude', what)
  return new ApiError(502, 'ai_invalid', 'Claude hat keine lesbare Antwort geliefert. Versuch es noch einmal.')
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
