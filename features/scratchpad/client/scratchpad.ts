'use client'
// Schmierzettel im Browser: Der ganze Text liegt im localStorage (offline les- und schreibbar) und geht kurz nach der
// letzten Änderung an den Server. War ein anderes Gerät schneller (409), werden beide Stände ohne Rückfrage
// zusammengeführt. Mehrere Tabs teilen sich den Speicher: Jede Änderung liest ihn frisch und schreibt ihn zurück.
import { useEffect, useSyncExternalStore } from 'react'
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { api, ApiError, errorMessage, NetworkError } from '@/shared/client/api'
import { mergeScratchpad } from '../scratchpad'
import { MAX_SCRATCHPAD_LENGTH } from '../limits'
import type { Scratchpad } from '../types'

/** Wie bei Notizen: kurz nach der letzten Taste senden, Ungesendetes regelmäßig erneut versuchen */
const SAVE_DELAY = 900
const RETRY_INTERVAL = 30_000

const scratchpadKey = ['scratchpad'] as const

type Stored = {
  content: string
  /** Server-Version, auf der `content` beruht */
  version: number
  /** Text dieser Server-Version – die Grundlage fürs Zusammenführen */
  base: string
  updatedAt: number | null
  /** Noch nicht gesendet */
  dirty: boolean
}

export type ScratchpadState = Stored & {
  status: 'saved' | 'saving' | 'offline' | 'error'
  error?: string
  /** Gerade mit dem Stand eines anderen Geräts zusammengeführt */
  merged: boolean
}

const EMPTY: Stored = { content: '', version: 0, base: '', updatedAt: null, dirty: false }
const INITIAL: ScratchpadState = { ...EMPTY, status: 'saved', merged: false }

class ScratchpadStore {
  private key = ''
  private state: ScratchpadState = INITIAL
  private listeners = new Set<() => void>()
  private started = false
  private flushing = false
  private again = false
  private timer: ReturnType<typeof setTimeout> | undefined
  /** Vom Server als ungültig abgelehnter Text – erst nach der nächsten Änderung erneut senden */
  private rejected: string | null = null
  private qc: QueryClient | null = null

  start(userId: number, qc: QueryClient) {
    this.qc = qc
    if (this.started) return
    this.started = true
    this.key = `noted:scratchpad:${userId}`
    this.state = { ...this.state, ...this.read() }
    window.addEventListener('storage', (e) => {
      if (e.key !== this.key) return
      this.state = { ...this.state, ...this.read() }
      this.emit()
    })
    window.addEventListener('online', () => void this.flush())
    // Beim Verlassen des Tabs noch schnell senden (keepalive), beim Zurückkehren Liegengebliebenes
    document.addEventListener('visibilitychange', () => void this.flush(document.visibilityState === 'hidden'))
    setInterval(() => {
      if (this.state.dirty) void this.flush()
    }, RETRY_INTERVAL)
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
      if (typeof raw?.content !== 'string') return EMPTY
      return {
        content: raw.content,
        version: Number.isInteger(raw.version) ? raw.version : 0,
        base: typeof raw.base === 'string' ? raw.base : '',
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : null,
        dirty: raw.dirty === true,
      }
    } catch {
      return EMPTY
    }
  }

  /** Frisch lesen, ändern, zurückschreiben – so geht nichts aus anderen Tabs verloren */
  private update(fn: (s: Stored) => Stored, extra: Partial<ScratchpadState> = {}) {
    const next = fn(this.key ? this.read() : this.state)
    if (this.key) {
      try {
        localStorage.setItem(this.key, JSON.stringify(next))
      } catch {
        /* voll – bleibt im Arbeitsspeicher */
      }
    }
    this.state = { ...this.state, ...next, ...extra }
    this.emit()
  }

  private setStatus(status: ScratchpadState['status'], error?: string) {
    this.state = { ...this.state, status, error }
    this.emit()
  }

  /** Neuer Text aus dem Textfeld: lokal sofort, an den Server kurz nach der letzten Änderung */
  set(content: string) {
    this.rejected = null
    const status = this.state.status === 'error' ? 'saved' : this.state.status
    this.update((s) => ({ ...s, content, dirty: true }), { merged: false, error: undefined, status })
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), SAVE_DELAY)
  }

  async flush(keepalive = false): Promise<void> {
    if (!this.key) return
    if (this.flushing) {
      this.again = true
      return
    }
    clearTimeout(this.timer)
    this.flushing = true
    try {
      do {
        this.again = false
        const s = this.read()
        if (!s.dirty) {
          if (this.state.status !== 'error') this.setStatus('saved')
          break
        }
        if (s.content === s.base) {
          this.update((x) => ({ ...x, dirty: x.content !== x.base }), { status: 'saved' })
          break
        }
        if (s.content === this.rejected) break
        if (s.content.length > MAX_SCRATCHPAD_LENGTH) {
          this.rejected = s.content
          this.setStatus('error', 'Der Schmierzettel ist zu lang (höchstens 20 000 Zeichen).')
          break
        }
        this.setStatus('saving')
        try {
          const { scratchpad: server } = await api<{ scratchpad: Scratchpad }>('/api/scratchpad', {
            method: 'PUT',
            body: { content: s.content, baseVersion: s.version },
            keepalive,
          })
          // Wurde inzwischen weitergeschrieben, bleibt der neue Text ungesendet – nur Version und Grundlage sind neu
          this.update((x) => ({
            content: x.content,
            version: server.version,
            base: server.content,
            updatedAt: server.updatedAt,
            dirty: x.content !== server.content,
          }))
          this.qc?.setQueryData(scratchpadKey, { scratchpad: server })
          if (this.state.dirty) this.again = true
          else this.setStatus('saved')
        } catch (err) {
          if (err instanceof ApiError && err.code === 'version_conflict' && isScratchpad(err.body.scratchpad)) {
            this.merge(err.body.scratchpad)
            this.again = true
          } else if (err instanceof NetworkError) {
            this.setStatus('offline')
          } else {
            // Als ungültig abgelehnt: nicht von selbst erneut senden, sonst hinge es ewig fest
            if (err instanceof ApiError && (err.status === 400 || err.status === 413)) this.rejected = s.content
            this.setStatus('error', errorMessage(err))
          }
        }
      } while (this.again)
    } finally {
      this.flushing = false
    }
  }

  /** Ein anderes Gerät war schneller: dessen Stand mit dem hiesigen zusammenführen und auf ihm aufbauen */
  private merge(theirs: Scratchpad) {
    let merged = false
    this.update((x) => {
      const content = mergeScratchpad(x.base, x.content, theirs.content)
      merged = content !== theirs.content && content !== x.content
      return { content, version: theirs.version, base: theirs.content, updatedAt: theirs.updatedAt, dirty: content !== theirs.content }
    })
    if (merged) {
      this.state = { ...this.state, merged }
      this.emit()
    }
  }

  /** Stand vom Server (beim Öffnen des Fensters) – nur, wenn er neuer ist und hier nichts ungesendet ist */
  receive(server: Scratchpad) {
    if (!this.key) return
    const s = this.read()
    if (s.dirty || server.version <= s.version) return
    this.update(() => ({
      content: server.content,
      version: server.version,
      base: server.content,
      updatedAt: server.updatedAt,
      dirty: false,
    }))
  }

  hasPending() {
    return !!this.key && this.read().dirty
  }

  clearAll() {
    clearTimeout(this.timer)
    if (this.key) localStorage.removeItem(this.key)
    this.state = INITIAL
    this.emit()
  }
}

function isScratchpad(value: unknown): value is Scratchpad {
  const v = value as Scratchpad | null
  return typeof v?.content === 'string' && typeof v.version === 'number'
}

export const scratchpad = new ScratchpadStore()

/** Zettel mit Stand der Synchronisierung – lädt bei jedem Öffnen und beim Zurückkehren in den Tab vom Server */
export function useScratchpad(): ScratchpadState {
  const query = useQuery({
    queryKey: scratchpadKey,
    queryFn: () => api<{ scratchpad: Scratchpad }>('/api/scratchpad'),
    staleTime: 0,
  })
  const server = query.data?.scratchpad
  // Abgleich mit dem Server (Server → lokal), daher im Effect
  useEffect(() => {
    if (server) scratchpad.receive(server)
  }, [server])
  return useSyncExternalStore(scratchpad.subscribe, scratchpad.getSnapshot, () => INITIAL)
}
