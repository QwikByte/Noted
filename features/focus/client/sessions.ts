'use client'
// Gezählte Runden des Fokus-Timers. Nach jeder Runde fragt Noted, ob sie zählen soll („offen“); bestätigte Runden
// liegen bis zum Senden im localStorage – wie die Bewertungen der Karteikarten, also auch offline.
// Mehrere Tabs teilen sich den Speicher: Jede Änderung liest ihn frisch und schreibt ihn zurück.
import { useMemo, useSyncExternalStore } from 'react'
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { api, ApiError, NetworkError } from '@/shared/client/api'
import { onPhaseEnded, type EndedPhase } from './focus-timer'
import { cleanSubject } from '../sessions'
import { MAX_GOAL, MAX_SUBJECT } from '../limits'
import type { FocusSession, FocusSessionData } from '../types'

/** Fach und Ziel der laufenden Runde (Eingabe im Fokus-Timer, auf dem Gerät gespeichert) */
export const SUBJECT_KEY = 'noted:focus:subject'
export const GOAL_KEY = 'noted:focus:goal'

const sessionsKey = ['focus-sessions'] as const
/** Offene Runden, die so lange niemand bestätigt, verfallen */
const PENDING_TTL = 7 * 86_400_000
const MAX_PENDING = 20

type Stored = { pending: FocusSession[]; outbox: FocusSession[] }

const EMPTY: Stored = { pending: [], outbox: [] }

class FocusSessionStore {
  private key = ''
  private state: Stored = EMPTY
  private listeners = new Set<() => void>()
  private flushing = false
  private started = false
  private qc: QueryClient | null = null

  start(userId: number, qc: QueryClient) {
    this.qc = qc
    if (this.started) return
    this.started = true
    this.key = `noted:focus:sessions:${userId}`
    this.state = this.read()
    window.addEventListener('storage', (e) => {
      if (e.key !== this.key) return
      this.state = this.read()
      this.emit()
    })
    window.addEventListener('online', () => void this.flush())
    onPhaseEnded((ended) => this.recordEnded(ended))
    setTimeout(() => void this.flush(), 1000)
    this.emit()
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  getSnapshot = () => this.state

  private emit() {
    for (const fn of this.listeners) fn()
  }

  private read(): Stored {
    try {
      const raw = JSON.parse(localStorage.getItem(this.key) ?? 'null')
      return { pending: Array.isArray(raw?.pending) ? raw.pending : [], outbox: Array.isArray(raw?.outbox) ? raw.outbox : [] }
    } catch {
      return EMPTY
    }
  }

  /** Frisch lesen, ändern, zurückschreiben – so geht nichts aus anderen Tabs verloren */
  private update(fn: (s: Stored) => Stored) {
    if (!this.key) return
    const next = fn(this.read())
    try {
      if (next.pending.length === 0 && next.outbox.length === 0) localStorage.removeItem(this.key)
      else localStorage.setItem(this.key, JSON.stringify(next))
    } catch {
      /* voll – bleibt im Arbeitsspeicher */
    }
    this.state = next
    this.emit()
  }

  /** Abgelaufene Fokus-Runde oder Countdown als offene Runde festhalten (Fach und Ziel wie gerade eingetragen) */
  recordEnded(ended: EndedPhase) {
    if (ended.phase !== 'focus' && ended.phase !== 'countdown') return
    const read = (key: string, max: number) => {
      try {
        return (localStorage.getItem(key) ?? '').trim().slice(0, max)
      } catch {
        return ''
      }
    }
    const session: FocusSession = {
      id: crypto.randomUUID(),
      subject: cleanSubject(read(SUBJECT_KEY, MAX_SUBJECT)),
      goal: read(GOAL_KEY, MAX_GOAL),
      startedAt: ended.startedAt,
      durationMs: ended.durationMs,
    }
    const cutoff = Date.now() - PENDING_TTL
    this.update((s) => {
      const known = [...s.pending, ...s.outbox].some((x) => x.startedAt === session.startedAt)
      const pending = (known ? s.pending : [...s.pending, session]).filter((x) => x.startedAt >= cutoff).slice(-MAX_PENDING)
      return { ...s, pending }
    })
  }

  /** Offene Runde, die zu einem Phasenende gehört (für „Zählen“ in der Meldung) */
  pendingEndingAt(endedAt: number): FocusSession | undefined {
    return this.state.pending.find((s) => s.startedAt + s.durationMs === endedAt)
  }

  confirm(id: string) {
    this.update((s) => {
      const session = s.pending.find((x) => x.id === id)
      return session ? { pending: s.pending.filter((x) => x.id !== id), outbox: [...s.outbox, session] } : s
    })
    void this.flush()
  }

  discard(id: string) {
    this.update((s) => ({ ...s, pending: s.pending.filter((x) => x.id !== id) }))
  }

  async flush(): Promise<void> {
    if (!this.key || this.flushing) return
    const batch = this.read().outbox
    if (batch.length === 0) return
    this.flushing = true
    try {
      await api('/api/focus/sessions', { method: 'POST', body: { sessions: batch } })
      this.done(batch)
      void this.qc?.invalidateQueries({ queryKey: sessionsKey })
    } catch (err) {
      // Offline oder Serverfehler: später erneut. Als ungültig abgelehnt: verwerfen, sonst hinge es ewig fest.
      if (!(err instanceof NetworkError) && err instanceof ApiError && (err.status === 400 || err.status === 413)) this.done(batch)
    } finally {
      this.flushing = false
    }
  }

  private done(batch: FocusSession[]) {
    const ids = new Set(batch.map((s) => s.id))
    this.update((s) => ({ ...s, outbox: s.outbox.filter((x) => !ids.has(x.id)) }))
  }

  clearAll() {
    if (this.key) localStorage.removeItem(this.key)
    this.state = EMPTY
    this.emit()
  }
}

export const focusSessions = new FocusSessionStore()

/** Offene und noch nicht gesendete Runden */
export function useLocalFocusSessions(): Stored {
  return useSyncExternalStore(focusSessions.subscribe, focusSessions.getSnapshot, () => EMPTY)
}

/** Gezählte Runden der letzten Monate (inkl. noch nicht gesendeter) und Vorschläge für das Fach */
export function useFocusSessions(): FocusSessionData & { isLoading: boolean } {
  const query = useQuery({ queryKey: sessionsKey, queryFn: () => api<FocusSessionData>('/api/focus/sessions') })
  const { outbox } = useLocalFocusSessions()
  return useMemo(() => {
    const known = new Set(query.data?.sessions.map((s) => s.id))
    const sessions = [...(query.data?.sessions ?? []), ...outbox.filter((s) => !known.has(s.id))]
    const subjects = [...new Set([...outbox.map((s) => s.subject).reverse(), ...(query.data?.subjects ?? [])].filter(Boolean))]
    return { sessions, subjects, isLoading: query.isLoading }
  }, [query.data, query.isLoading, outbox])
}
