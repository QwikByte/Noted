import 'server-only'
import { ApiError, badRequest } from '@/shared/server/http'
import { assistPrompt } from '../assist'
import type { AssistEvent, AssistRequest } from '../types'
import { claudeClient, claudeError, contentBlocks, fallbackParams, refusedError } from './claude'
import { checkNoteForAi } from './note-access'
import { requireAiCredentials } from './settings'

/** Auch eine ganze, überarbeitete Notiz passt hinein (gestreamt, daher ohne Zeitlimit der Verbindung) */
const MAX_TOKENS = 64_000

const encoder = new TextEncoder()
const line = (event: AssistEvent) => encoder.encode(JSON.stringify(event) + '\n')

/** Unterwegs aufgetretener Fehler als Zeile – SDK-Fehler mit ihrer verständlichen Meldung */
function errorEvent(err: unknown): AssistEvent {
  try {
    const e = err instanceof ApiError ? err : claudeError(err)
    return { error: e.message, code: e.code }
  } catch (unknown) {
    console.error('[noted] Assistent abgebrochen', unknown)
    return { error: 'Die Antwort ist unterwegs abgebrochen. Versuch es noch einmal.', code: 'internal' }
  }
}

/**
 * Assistent: Claude ändert einen Text oder beantwortet eine Frage dazu. Die Antwort kommt als Strom von JSON-Zeilen
 * (AssistEvent). Fehler beim Verbindungsaufbau (Schlüssel, Guthaben …) werden vorher als normale Fehler geworfen.
 */
export async function assist(userId: number, req: AssistRequest, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  const { apiKey, model } = requireAiCredentials(userId)
  if (req.noteId) checkNoteForAi(userId, req.noteId)
  if (!req.text.trim() && !req.images?.length) throw badRequest('Es gibt keinen Text, mit dem Claude arbeiten könnte.')
  if (!req.instruction.trim()) throw badRequest('Schreib, was Claude tun soll.')

  const prompt = assistPrompt(req)
  const stream = claudeClient(apiKey).beta.messages.stream(
    {
      model,
      max_tokens: MAX_TOKENS,
      system: prompt.system,
      messages: [{ role: 'user', content: contentBlocks(prompt) }],
      // Schnell antworten: Umformulieren und Erklären brauchen wenig Nachdenken
      output_config: { effort: 'low' },
      ...fallbackParams(model),
    },
    { signal },
  )
  try {
    await stream.withResponse()
  } catch (err) {
    throw claudeError(err)
  }

  // Bricht der Browser ab, darf nichts mehr in den Strom geschrieben werden
  let cancelled = false
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AssistEvent) => {
        if (!cancelled) controller.enqueue(line(event))
      }
      try {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') send({ text: event.delta.text })
          // Ab hier schreibt ein anderes Modell neu – was das erste schon geschrieben hatte, gilt nicht mehr
          else if (event.type === 'content_block_start' && event.content_block.type === 'fallback') send({ reset: true })
        }
        const message = await stream.finalMessage()
        if (message.stop_reason === 'refusal') {
          const e = refusedError()
          send({ error: e.message, code: e.code })
        } else {
          send({ done: true, truncated: message.stop_reason === 'max_tokens' })
        }
      } catch (err) {
        if (!cancelled && !signal?.aborted) send(errorEvent(err))
      } finally {
        if (!cancelled) controller.close()
      }
    },
    cancel() {
      cancelled = true
      stream.abort()
    },
  })
}
