'use client'
// KI-Chat im Browser: Der Verlauf liegt nur im Arbeitsspeicher dieses Tabs – er übersteht das Schließen des Fensters und
// Seitenwechsel, aber nicht das Neuladen, und wird nirgends gespeichert. Für Claude hält der Tab den Verlauf genau so,
// wie ihn der Server zurückgibt, und hängt nur an.
import { useSyncExternalStore } from 'react'
import { apiResponse, errorMessage } from '@/shared/client/api'
import { localDate } from '@/features/calendar/dates'
import { readAssistEvents } from '../assist'
import type { ChatEvent, ChatProposal, ChatQuestion } from '../types'

/** Ein Stück der Antwort in der Reihenfolge, in der es kam */
export type ChatPart =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; label: string; done: boolean; error?: string }
  /** `applied`: Rückmeldung nach dem Anlegen (z. B. „3 Karten erstellt“) */
  | { kind: 'proposal'; id: string; proposal: ChatProposal; applied?: string }
  | { kind: 'notice'; text: string }

export type ChatTurn = {
  id: string
  question: ChatQuestion
  parts: ChatPart[]
  /** `stopped`: abgebrochen – wie `error` nicht im Verlauf, Claude kennt die Frage danach nicht */
  status: 'running' | 'done' | 'error' | 'stopped'
  error?: string
  truncated?: boolean
}

type State = { turns: ChatTurn[]; history: unknown[] }

const EMPTY: State = { turns: [], history: [] }

let state: State = EMPTY
let running: AbortController | null = null
const listeners = new Set<() => void>()

function set(next: State) {
  state = next
  listeners.forEach((l) => l())
}

function updateTurn(id: string, fn: (turn: ChatTurn) => ChatTurn) {
  set({ ...state, turns: state.turns.map((t) => (t.id === id ? fn(t) : t)) })
}

/** Ereignis des Servers in die Stücke der Antwort einarbeiten – `stepStart`: wo der laufende Schritt begann */
export function applyChatEvent(parts: ChatPart[], event: ChatEvent, stepStart: number): ChatPart[] {
  if ('text' in event) {
    const last = parts[parts.length - 1]
    return last?.kind === 'text' && parts.length > stepStart
      ? [...parts.slice(0, -1), { ...last, text: last.text + event.text }]
      : [...parts, { kind: 'text', text: event.text }]
  }
  if ('reset' in event) return parts.slice(0, stepStart)
  if ('tool' in event) return [...parts, { kind: 'tool', id: event.tool.id, label: event.tool.label, done: false }]
  if ('toolDone' in event) {
    const { id, label, error } = event.toolDone
    return parts.map((p) => (p.kind === 'tool' && p.id === id ? { ...p, done: true, error, label: label ?? p.label } : p))
  }
  if ('proposal' in event) return [...parts, { kind: 'proposal', id: event.proposal.id, proposal: event.proposal.proposal }]
  if ('notice' in event) return [...parts, { kind: 'notice', text: event.notice }]
  return parts
}

const pad = (n: number) => String(n).padStart(2, '0')

export const chatStore = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getSnapshot: () => state,

  /** Neuer Chat: laufende Antwort abbrechen, alles vergessen */
  reset() {
    running?.abort()
    running = null
    set(EMPTY)
  },

  stop() {
    running?.abort()
  },

  /**
   * Frage stellen. `onWebUnavailable`: Die Websuche ist für den Zugang abgeschaltet – der Aufrufer schaltet sie für
   * die nächsten Fragen aus.
   */
  async send(question: ChatQuestion, opts: { web: boolean; onWebUnavailable?: () => void }) {
    if (running) return
    const controller = new AbortController()
    running = controller
    const id = crypto.randomUUID()
    set({ ...state, turns: [...state.turns, { id, question, parts: [], status: 'running' }] })
    const history = state.history
    const now = new Date()
    let stepStart = 0
    let messages: unknown[] | null = null
    let finished = false

    const handle = (event: ChatEvent) => {
      if ('step' in event) {
        stepStart = state.turns.find((t) => t.id === id)?.parts.length ?? 0
      } else if ('messages' in event) {
        messages = event.messages
        if (!event.web && opts.web) opts.onWebUnavailable?.()
      } else if ('done' in event) {
        finished = true
        const added = messages
        // Nur, solange die Frage noch zum Chat gehört (nicht nach „Neuer Chat“)
        if (added && state.turns.some((t) => t.id === id)) set({ ...state, history: [...history, ...added] })
        updateTurn(id, (t) => ({ ...t, status: added ? 'done' : 'error', truncated: event.truncated, error: added ? undefined : 'Die Antwort kam unvollständig an.' }))
      } else if ('error' in event) {
        finished = true
        updateTurn(id, (t) => ({ ...t, status: 'error', error: event.error }))
      } else {
        updateTurn(id, (t) => ({ ...t, parts: applyChatEvent(t.parts, event, stepStart) }))
      }
    }

    try {
      const res = await apiResponse('/api/ai/chat', {
        method: 'POST',
        body: { history, question, now: { date: localDate(now), time: `${pad(now.getHours())}:${pad(now.getMinutes())}` }, web: opts.web },
        signal: controller.signal,
      })
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        if (!reader) break
        const { done, value } = await reader.read()
        if (done) break
        const { events, rest } = readAssistEvents<ChatEvent>(buffer + decoder.decode(value, { stream: true }))
        buffer = rest
        events.forEach(handle)
      }
      readAssistEvents<ChatEvent>(buffer + decoder.decode() + '\n').events.forEach(handle)
      if (!finished) updateTurn(id, (t) => ({ ...t, status: 'error', error: 'Die Antwort ist unterwegs abgebrochen. Versuch es noch einmal.' }))
    } catch (err) {
      updateTurn(id, (t) =>
        controller.signal.aborted ? { ...t, status: 'stopped' } : { ...t, status: 'error', error: errorMessage(err) },
      )
    } finally {
      if (running === controller) running = null
    }
  },

  /** Abgebrochene oder gescheiterte Frage noch einmal stellen – sie ersetzt den alten Versuch */
  retry(turnId: string, opts: { web: boolean; onWebUnavailable?: () => void }) {
    const turn = state.turns.find((t) => t.id === turnId)
    if (!turn || running) return
    set({ ...state, turns: state.turns.filter((t) => t.id !== turnId) })
    void chatStore.send(turn.question, opts)
  },

  /** Vorschlag wurde angelegt – Rückmeldung am Vorschlag zeigen */
  markApplied(turnId: string, partId: string, text: string) {
    updateTurn(turnId, (t) => ({
      ...t,
      parts: t.parts.map((p) => (p.kind === 'proposal' && p.id === partId ? { ...p, applied: text } : p)),
    }))
  },
}

export function useChat(): State {
  return useSyncExternalStore(chatStore.subscribe, chatStore.getSnapshot, () => EMPTY)
}
