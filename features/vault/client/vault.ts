'use client'
// Tresor im Browser: Der Schlüssel liegt nur im Arbeitsspeicher dieses Tabs (nicht exportierbar, nie in localStorage
// oder IndexedDB) – Neuladen sperrt. Entschlüsselte Titel und Namen werden zwischengespeichert. Nach Inaktivität sperrt
// der Tab von selbst; Sperren gilt für alle Tabs (BroadcastChannel, nur die Nachricht „sperren“), Entsperren nur hier.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/shared/client/api'
import { decryptField, encryptField, unlockWithPassword, unlockWithRecoveryKey, VaultError } from '../crypto'
import { VAULT_ENVELOPE_RE, type VaultField } from '../format'
import type { VaultInfo } from '../types'

export const vaultKey = ['vault'] as const
/** Minuten ohne Eingabe bis zum automatischen Sperren – je Gerät (usePref) */
export const AUTO_LOCK_PREF = 'noted:vaultLock'
export const AUTO_LOCK_MINUTES = ['5', '15', '60'] as const
const DEFAULT_AUTO_LOCK = 15
const CHANNEL = 'noted-vault'
const IDLE_CHECK_MS = 15_000

type Snapshot = {
  unlocked: boolean
  /** Zählt jedes Entsperren – Entschlüsseltes von vorher gilt nicht mehr */
  epoch: number
  /** Zählt jede neu entschlüsselte Angabe hoch – damit Listen die Titel nachziehen */
  revision: number
}

const LOCKED: Snapshot = { unlocked: false, epoch: 0, revision: 0 }

export type Reveal = { id: string; field: VaultField; envelope: string }

const cacheKey = ({ id, field, envelope }: Reveal) => `${id}|${field}|${envelope}`

class VaultStore {
  private key: CryptoKey | null = null
  private cache = new Map<string, string | VaultError>()
  private pending = new Set<string>()
  private inflight = 0
  private idleWaiters: (() => void)[] = []
  private lastInput = Date.now()
  private channel: BroadcastChannel | null = null
  private listeners = new Set<() => void>()
  private snapshot: Snapshot = LOCKED
  private started = false
  private emitQueued = false

  start() {
    if (this.started) return
    this.started = true
    const touch = () => {
      this.lastInput = Date.now()
    }
    for (const type of ['keydown', 'pointerdown', 'wheel', 'touchstart']) {
      window.addEventListener(type, touch, { capture: true, passive: true })
    }
    // Im Hintergrund laufen Timer gedrosselt – beim Zurückkehren erst prüfen, dann zeigen
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.lockIfIdle()
    })
    setInterval(() => this.lockIfIdle(), IDLE_CHECK_MS)
    if ('BroadcastChannel' in window) {
      this.channel = new BroadcastChannel(CHANNEL)
      this.channel.onmessage = (e) => {
        if (e.data === 'lock') void this.lock({ broadcast: false })
      }
    }
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  getSnapshot = () => this.snapshot

  private emit(opened = false) {
    const { epoch, revision } = this.snapshot
    this.snapshot = { unlocked: this.key !== null, epoch: opened ? epoch + 1 : epoch, revision: revision + 1 }
    for (const fn of this.listeners) fn()
  }

  /** Viele Entschlüsselungen auf einmal (Notizliste) lösen nur ein Neuzeichnen aus */
  private emitSoon() {
    if (this.emitQueued) return
    this.emitQueued = true
    queueMicrotask(() => {
      this.emitQueued = false
      this.emit()
    })
  }

  get unlocked() {
    return this.key !== null
  }

  private lockIfIdle() {
    if (!this.key) return
    let minutes = DEFAULT_AUTO_LOCK
    try {
      minutes = Number(localStorage.getItem(AUTO_LOCK_PREF)) || DEFAULT_AUTO_LOCK
    } catch {
      /* Standard */
    }
    if (Date.now() - this.lastInput >= minutes * 60_000) void this.lock()
  }

  private open(key: CryptoKey) {
    this.key = key
    this.lastInput = Date.now()
    this.cache.clear()
    this.emit(true)
  }

  async unlockWithPassword(info: VaultInfo, password: string) {
    this.open(await unlockWithPassword(info, password))
  }

  async unlockWithRecoveryKey(info: VaultInfo, recoveryKey: string) {
    this.open(await unlockWithRecoveryKey(info, recoveryKey))
  }

  /** Schlüssel eines eben angelegten Tresors übernehmen */
  unlockWithKey(key: CryptoKey) {
    this.open(key)
  }

  /**
   * Sperren: laufende Verschlüsselungen abwarten, dann Schlüssel und Entschlüsseltes verwerfen. JavaScript kann
   * Klartext im Speicher nicht gezielt überschreiben – die App hält danach nur keine Verweise mehr darauf.
   */
  async lock({ broadcast = true }: { broadcast?: boolean } = {}) {
    if (broadcast) this.channel?.postMessage('lock')
    if (!this.key) return
    if (this.inflight > 0) await new Promise<void>((resolve) => this.idleWaiters.push(resolve))
    this.key = null
    this.cache.clear()
    this.pending.clear()
    this.emit()
  }

  async encrypt(id: string, field: VaultField, text: string): Promise<string> {
    const key = this.key
    if (!key) throw new VaultError('locked')
    this.inflight++
    try {
      return await encryptField(key, id, field, text)
    } finally {
      if (--this.inflight === 0) for (const resolve of this.idleWaiters.splice(0)) resolve()
    }
  }

  /**
   * Entschlüsseln – beschädigte Umschläge werfen `VaultError('corrupt')`. Titel und Namen kommen in den
   * Zwischenspeicher, Inhalte nicht (groß und nur beim Öffnen gebraucht).
   */
  async decrypt(reveal: Reveal): Promise<string> {
    const key = this.key
    if (!key) throw new VaultError('locked')
    const cached = this.cache.get(cacheKey(reveal))
    if (cached instanceof VaultError) throw cached
    if (cached !== undefined) return cached
    const remember = (value: string | VaultError) => {
      if (this.key === key && reveal.field !== 'content') this.cache.set(cacheKey(reveal), value)
    }
    try {
      const text = await decryptField(key, reveal.id, reveal.field, reveal.envelope)
      remember(text)
      return text
    } catch (err) {
      const error = err instanceof VaultError ? err : new VaultError('corrupt')
      remember(error)
      throw error
    }
  }

  /** Schon Entschlüsseltes ohne Warten – `undefined`, solange es noch nicht so weit ist */
  peek(reveal: Reveal): string | VaultError | undefined {
    return this.cache.get(cacheKey(reveal))
  }

  /** Im Hintergrund entschlüsseln, was eine Liste zeigen will */
  request(reveals: Reveal[]) {
    if (!this.key) return
    for (const r of reveals) {
      const k = cacheKey(r)
      if (this.cache.has(k) || this.pending.has(k)) continue
      this.pending.add(k)
      void this.decrypt(r)
        .catch(() => {})
        .finally(() => {
          this.pending.delete(k)
          this.emitSoon()
        })
    }
  }
}

export const vault = new VaultStore()

export const isEnvelope = (text: string | null | undefined): text is string =>
  typeof text === 'string' && VAULT_ENVELOPE_RE.test(text)

/** Entsperrt? (mit Zähler, der bei jeder neu entschlüsselten Angabe steigt) */
export function useVaultState(): Snapshot {
  return useSyncExternalStore(vault.subscribe, vault.getSnapshot, () => LOCKED)
}

/** Verpacktes Schlüsselmaterial – `null` ohne Tresor; der Service Worker hält es fürs Entsperren offline vor */
export function useVaultInfo() {
  return useQuery({
    queryKey: vaultKey,
    queryFn: () => api<{ vault: VaultInfo | null }>('/api/vault').then((r) => r.vault),
    staleTime: 60_000,
  })
}

/** Einzelnen Text entschlüsseln (z. B. einen älteren Stand) – `null`, solange es noch dauert oder gesperrt ist */
export function useDecrypted(reveal: Reveal | null): string | VaultError | null {
  const { unlocked, epoch } = useVaultState()
  const [result, setResult] = useState<{ key: string; value: string | VaultError } | null>(null)
  const key = reveal && unlocked ? `${epoch}|${cacheKey(reveal)}` : ''
  useEffect(() => {
    if (!key || !reveal) return
    let cancelled = false
    vault.decrypt(reveal).then(
      (text) => {
        if (!cancelled) setResult({ key, value: text })
      },
      (err: unknown) => {
        if (!cancelled) setResult({ key, value: err instanceof VaultError ? err : new VaultError('corrupt') })
      },
    )
    return () => {
      cancelled = true
    }
    // `key` steht für den Umschlag – das Objekt selbst ist bei jedem Aufruf neu
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return result && result.key === key ? result.value : null
}

/** Entschlüsselt die übergebenen Angaben im Hintergrund, sobald der Tresor offen ist */
export function useRevealRequest(reveals: Reveal[]) {
  const { unlocked } = useVaultState()
  useEffect(() => {
    if (unlocked && reveals.length > 0) vault.request(reveals)
  }, [unlocked, reveals])
}
