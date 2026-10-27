import 'server-only'
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages'
import { getNote } from '@/features/notes/server/notes'
import { ApiError, badRequest } from '@/shared/server/http'
import { CARDS_SCHEMA, CARDS_SYSTEM, cardsPrompt, parseSuggestedCards } from '../cards'
import type { AiModel } from '../models'
import type { SuggestedCard } from '../types'
import { claudeClient, claudeError } from './claude'
import { getAiCredentials } from './settings'

/** Für Haiku gibt es keinen Fallback auf ein anderes Modell */
const NO_FALLBACK: AiModel[] = ['claude-haiku-5-5']

/** Platz für das Nachdenken und bis zu MAX_AI_CARDS ausführliche Karten */
const MAX_TOKENS = 32_000

type CardsInput = { noteId: string; title: string; content: string; existing?: string[]; wishes?: string }

/**
 * Nur Notizen, die der Server kennt und die nicht im Tresor liegen. Eine unbekannte könnte eine offline angelegte
 * Tresor-Notiz sein – deren Klartext darf nicht an Claude gehen.
 */
function checkNote(userId: number, noteId: string) {
  let vault: boolean
  try {
    vault = getNote(userId, noteId).vault
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      throw badRequest('Die Notiz ist noch nicht auf dem Server. Warte kurz, bis sie synchronisiert ist.', 'not_synced')
    }
    throw err
  }
  if (vault) throw badRequest('Notizen aus dem Tresor gehen nicht an Claude.', 'vault')
}

/** Antworttext – nach einem Fallback der des Modells, das zuletzt geschrieben hat */
const lastText = (message: BetaMessage) => message.content.findLast((b) => b.type === 'text')?.text

/** Lässt Claude Karteikarten aus einer Notiz vorschlagen – mit dem Schlüssel und Modell des Kontos */
export async function suggestCards(userId: number, input: CardsInput, signal?: AbortSignal): Promise<SuggestedCard[]> {
  const credentials = getAiCredentials(userId)
  if (!credentials) {
    throw new ApiError(400, 'ai_not_configured', 'Hinterlege zuerst unter Einstellungen → KI deinen Anthropic-API-Schlüssel.')
  }
  checkNote(userId, input.noteId)
  if (!input.content.trim()) throw badRequest('Die Notiz ist leer.')

  const { apiKey, model } = credentials
  const fallback = NO_FALLBACK.includes(model)
    ? {}
    : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
  let message: BetaMessage
  try {
    // Gestreamt, damit lange Antworten nicht an Zeitlimits der Verbindung scheitern
    const stream = claudeClient(apiKey).beta.messages.stream(
      {
        model,
        max_tokens: MAX_TOKENS,
        system: CARDS_SYSTEM,
        messages: [{ role: 'user', content: cardsPrompt(input) }],
        // Bewusst ohne Parser des SDK: Der läse jeden Textblock als JSON – auch den abgebrochenen Anfang einer
        // Antwort, die nach einer Ablehnung ein anderes Modell neu geschrieben hat (Fallback). Siehe lastText.
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: CARDS_SCHEMA } },
        ...fallback,
      },
      { signal },
    )
    message = await stream.finalMessage()
  } catch (err) {
    throw claudeError(err)
  }

  if (message.stop_reason === 'refusal') {
    throw new ApiError(
      422,
      'ai_refused',
      'Claude hat die Anfrage abgelehnt. Das kommt selten auch bei harmlosen Themen vor – versuch es mit einem anderen Modell oder einem Teil der Notiz.',
    )
  }
  if (message.stop_reason === 'max_tokens') {
    throw new ApiError(422, 'ai_too_long', 'Die Antwort wurde zu lang. Wünsch dir weniger Karten oder nimm einen Teil der Notiz.')
  }
  const text = lastText(message)
  const cards = text === undefined ? null : parseSuggestedCards(text)
  if (!cards) {
    console.error('[noted] Unerwartete Antwort von Claude', { model: message.model, stopReason: message.stop_reason })
    throw new ApiError(502, 'ai_invalid', 'Claude hat keine lesbaren Karten geliefert. Versuch es noch einmal.')
  }
  return cards
}
