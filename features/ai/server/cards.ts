import 'server-only'
import { badRequest } from '@/shared/server/http'
import { CARDS_SCHEMA, cardsLimits, cardsPrompt, parseSuggestedCards } from '../cards'
import type { CardsRequest, SuggestedCard } from '../types'
import { invalidAnswer, structured } from './claude'
import { checkNoteForAi } from './note-access'
import { requireAiCredentials } from './settings'

/** Platz für das Nachdenken und bis zu MAX_AI_CARDS ausführliche Karten */
const MAX_TOKENS = 32_000

/** Lässt Claude Karteikarten vorschlagen – aus einer Notiz, einem PDF oder einer vorhandenen Karte */
export async function suggestCards(userId: number, request: CardsRequest, signal?: AbortSignal): Promise<SuggestedCard[]> {
  const credentials = requireAiCredentials(userId)
  const { source } = request
  if (source.kind === 'note') {
    checkNoteForAi(userId, source.noteId)
    if (!source.content.trim()) throw badRequest('Die Notiz ist leer.')
  }
  if (source.kind === 'text' && !source.content.trim()) throw badRequest('Der Text ist leer.')
  if (source.kind === 'pdf' && !source.pages.length && !source.marks.length) {
    throw badRequest('Wähle Seiten oder Markierungen aus.')
  }
  const text = await structured(
    credentials,
    cardsPrompt(request),
    {
      schema: CARDS_SCHEMA,
      maxTokens: MAX_TOKENS,
      effort: 'medium',
      tooLong: 'Die Antwort wurde zu lang. Wünsch dir weniger Karten oder nimm einen Teil des Inhalts.',
    },
    signal,
  )
  const cards = text === undefined ? null : parseSuggestedCards(text, cardsLimits(request))
  if (!cards) throw invalidAnswer('Karten')
  return cards
}
