import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import type { BetaMessageParam, BetaToolResultBlockParam, BetaToolUseBlock } from '@anthropic-ai/sdk/resources/beta/messages'
import { getNote } from '@/features/notes/server/notes'
import { ApiError, badRequest } from '@/shared/server/http'
import { CHAT_SYSTEM, chatTools, chatUserContent, parseProposal, toolLabel, type CheckedRef } from '../chat'
import type { ChatEvent, ChatRef, ChatRequest } from '../types'
import { claudeClient, claudeError, errorEvent, fallbackParams, ndjsonLine, refusedError } from './claude'
import { findNote, READ_TOOLS, runReadTool } from './chat-tools'
import { requireAiCredentials } from './settings'

/** Höchstens so viele Anfragen an Claude je Frage (jede Werkzeugrunde ist eine) */
const MAX_ROUNDS = 12
const MAX_TOKENS = 32_000
/** Wie oft eine Runde neu angefragt wird, wenn eine gestreamte Werkzeugeingabe kein lesbares JSON war */
const MAX_JSON_RETRIES = 2
/**
 * Gedankengänge, die nicht mehr zum Verlauf passen (etwa nach dem Ein- oder Ausschalten der Websuche), verwirft die
 * API, statt die Anfrage abzulehnen
 */
const BINDING_BETA = 'thinking-binding-controls-2026-08-01'

const PROPOSED = 'Der Person als Vorschlag angezeigt. Angelegt wird erst, wenn sie bestätigt – erwähne den Inhalt nicht noch einmal.'
const LIMIT_REACHED = 'Abgebrochen: zu viele Schritte. Antworte mit dem, was du bisher weißt.'

/** Hat ein Admin die Websuche für die Organisation abgeschaltet, lehnt Anthropic jede Anfrage mit dem Werkzeug ab */
const webSearchDisabled = (err: unknown) => err instanceof Anthropic.BadRequestError && /web.?search/i.test(err.message)

/** Unlesbares JSON in einer gestreamten Werkzeugeingabe meldet das SDK selbst – kein Fehler der API */
const badToolJson = (err: unknown) =>
  err instanceof Anthropic.AnthropicError && !(err instanceof Anthropic.APIError) && /tool parameter JSON/i.test(err.message)

/**
 * Bezug prüfen: Notizen nur, wenn der Server sie kennt und sie nicht im Tresor liegen – mit dem Titel vom Server (eine
 * unbekannte könnte eine offline angelegte Tresor-Notiz sein)
 */
function checkRefs(userId: number, refs: ChatRef[]): CheckedRef[] {
  const out: CheckedRef[] = []
  for (const r of refs) {
    if (r.kind === 'pdf') {
      out.push(r)
      continue
    }
    try {
      const note = getNote(userId, r.id)
      if (!note.vault) out.push({ kind: 'note', id: note.id, title: note.title })
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) throw err
    }
  }
  return out
}

/**
 * KI-Chat: Claude beantwortet die Frage und liest dafür bei Bedarf Notizen, Dateien, Karten, Lernstand und Termine
 * (Werkzeuge) oder sucht im Netz. Die Antwort kommt als Strom von JSON-Zeilen (ChatEvent); am Ende stehen die neuen
 * Einträge für den Verlauf. Fehler beim Verbindungsaufbau werden vorher als normale Fehler geworfen.
 */
export async function chat(userId: number, req: ChatRequest, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  const { apiKey, model } = requireAiCredentials(userId)
  const { question } = req
  if (!question.text.trim() && !question.images.length) throw badRequest('Schreib eine Frage.')
  const history = req.history as BetaMessageParam[]
  const added: BetaMessageParam[] = [{ role: 'user', content: chatUserContent(question, checkRefs(userId, question.refs), req.now) }]
  const client = claudeClient(apiKey)
  const fallback = fallbackParams(model)
  let web = req.web

  const request = () =>
    client.beta.messages.stream(
      {
        model,
        max_tokens: MAX_TOKENS,
        system: CHAT_SYSTEM,
        tools: chatTools(web),
        messages: [...history, ...added],
        thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
        output_config: { effort: 'medium' },
        // Ab der zweiten Runde und Frage liest Anthropic den bisherigen Verlauf aus dem Zwischenspeicher
        cache_control: { type: 'ephemeral' },
        ...fallback,
        betas: [...(fallback.betas ?? []), BINDING_BETA],
      },
      { signal },
    )

  // Die erste Anfrage vorab: Fehler wie ein ungültiger Schlüssel kommen so als normale Antwort statt mitten im Strom
  let notice: string | null = null
  let current: ReturnType<typeof request>
  try {
    current = request()
    await current.withResponse()
  } catch (err) {
    if (!web || !webSearchDisabled(err)) throw claudeError(err)
    web = false
    notice = 'Die Websuche ist für deinen Anthropic-Zugang abgeschaltet – Claude antwortet ohne sie.'
    try {
      current = request()
      await current.withResponse()
    } catch (retry) {
      throw claudeError(retry)
    }
  }

  let cancelled = false
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatEvent) => {
        if (!cancelled) controller.enqueue(ndjsonLine(event))
      }

      /** Ein Werkzeug ausführen: lesen oder einen Vorschlag zeigen */
      const run = (use: BetaToolUseBlock): BetaToolResultBlockParam => {
        if (use.name.startsWith('propose_')) {
          const result = parseProposal(use.name, use.input, (ref) => findNote(userId, ref)?.id ?? null)
          if ('error' in result) {
            send({ toolDone: { id: use.id, error: result.error } })
            return { type: 'tool_result', tool_use_id: use.id, is_error: true, content: result.error }
          }
          send({ proposal: { id: use.id, proposal: result.proposal } })
          send({ toolDone: { id: use.id } })
          return { type: 'tool_result', tool_use_id: use.id, content: PROPOSED }
        }
        const out = READ_TOOLS.has(use.name)
          ? runReadTool(userId, use.name, use.input, req.now.date)
          : { content: `Unbekanntes Werkzeug ${use.name}.`, error: 'Unbekanntes Werkzeug', label: undefined }
        send({ toolDone: { id: use.id, label: out.label, error: out.error } })
        return { type: 'tool_result', tool_use_id: use.id, content: out.content, ...(out.error ? { is_error: true } : {}) }
      }

      try {
        if (notice) send({ notice })
        let truncated = false
        let jsonRetries = 0
        // Die erste Anfrage läuft schon – jede weitere Runde (auch eine wiederholte) fragt neu an
        let started: ReturnType<typeof request> | null = current
        for (let round = 0; ; round++) {
          current = started ?? request()
          started = null
          const stream = current
          send({ step: true })
          // Werkzeugaufrufe dieser Runde nach Position – beschriftet wird, sobald ihre Eingabe vollständig ist
          const calls = new Map<number, { id: string; name: string }>()
          let message
          try {
            for await (const event of stream) {
              if (event.type === 'content_block_start') {
                const block = event.content_block
                // Ein anderes Modell schreibt nach einer Ablehnung neu – was das erste geschrieben hatte, gilt nicht mehr
                if (block.type === 'fallback') send({ reset: true })
                else if (block.type === 'tool_use' || block.type === 'server_tool_use') calls.set(event.index, { id: block.id, name: block.name })
              } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                send({ text: event.delta.text })
              } else if (event.type === 'content_block_stop') {
                const call = calls.get(event.index)
                const block = stream.currentMessage?.content[event.index]
                if (call) send({ tool: { id: call.id, label: toolLabel(call.name, block && 'input' in block ? block.input : {}) } })
              }
            }
            message = await stream.finalMessage()
            jsonRetries = 0
          } catch (err) {
            // Unlesbares JSON in einer gestreamten Werkzeugeingabe: dieselbe Runde noch einmal
            if (!badToolJson(err) || jsonRetries++ >= MAX_JSON_RETRIES) throw err
            send({ reset: true })
            round--
            continue
          }

          if (message.stop_reason === 'refusal') {
            const e = refusedError()
            send({ error: e.message, code: e.code })
            return
          }
          added.push({ role: 'assistant', content: message.content })
          // Die Websuche hat ihre Grenze an Schritten erreicht: so zurückschicken, Anthropic setzt fort
          if (message.stop_reason === 'pause_turn' && round + 1 < MAX_ROUNDS) continue
          const uses = message.content.filter((b): b is BetaToolUseBlock => b.type === 'tool_use')
          if (message.stop_reason !== 'tool_use' || !uses.length) {
            truncated = message.stop_reason === 'max_tokens'
            break
          }
          if (round + 1 >= MAX_ROUNDS) {
            // Jeder Werkzeugaufruf braucht ein Ergebnis, sonst ließe sich der Verlauf nicht fortsetzen
            added.push({ role: 'user', content: uses.map((u) => ({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: LIMIT_REACHED })) })
            send({ notice: 'Claude hat zu viele Schritte gebraucht und wurde angehalten. Frag gern genauer nach.' })
            break
          }
          added.push({ role: 'user', content: uses.map(run) })
        }
        send({ messages: added, web })
        send({ done: true, truncated })
      } catch (err) {
        if (!cancelled && !signal?.aborted) send(errorEvent(err))
      } finally {
        if (!cancelled) controller.close()
      }
    },
    cancel() {
      cancelled = true
      current.abort()
    },
  })
}
