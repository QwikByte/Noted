import 'server-only'
import { listTags } from '@/features/notes/server/notes'
import { extractTags } from '@/shared/markdown/meta'
import { badRequest } from '@/shared/server/http'
import { META_SCHEMA, metaPrompt, parseMeta } from '../meta'
import type { MetaSuggestion } from '../types'
import { invalidAnswer, structured } from './claude'
import { checkNoteForAi } from './note-access'
import { requireAiCredentials } from './settings'

/** Titel und Tags für eine Notiz vorschlagen – bevorzugt aus den Tags, die das Konto schon nutzt */
export async function suggestMeta(
  userId: number,
  input: { noteId: string; title: string; content: string },
  signal?: AbortSignal,
): Promise<MetaSuggestion> {
  const credentials = requireAiCredentials(userId)
  checkNoteForAi(userId, input.noteId)
  if (!input.content.trim()) throw badRequest('Die Notiz ist leer.')
  const current = extractTags(input.content)
  const text = await structured(
    credentials,
    metaPrompt({ ...input, known: listTags(userId), current }),
    { schema: META_SCHEMA, maxTokens: 4_000, effort: 'low', tooLong: 'Die Antwort wurde zu lang. Versuch es noch einmal.' },
    signal,
  )
  const suggestion = text === undefined ? null : parseMeta(text, current)
  if (!suggestion) throw invalidAnswer('Titel und Tags')
  return suggestion
}
