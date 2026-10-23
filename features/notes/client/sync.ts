'use client'
// Lokale Sicherung und Synchronisierung von Notizen.
//
// Jede Änderung wird zuerst im localStorage gespeichert („Entwurf“) und dann
// verzögert an den Server geschickt. Klappt das nicht (offline), bleibt der Entwurf
// erhalten und wird automatisch nachgesendet, sobald wieder eine Verbindung besteht.
// Versionsnummern verhindern, dass Änderungen von einem anderen Gerät überschrieben werden.

import { api, ApiError, NetworkError, errorMessage } from '@/shared/client/api'
import type { Note, NoteFormat } from '../types'

export type Draft = {
  id: string
  /** Noch nicht auf dem Server angelegt */
  isNew: boolean
  /** undefined = unverändert */
  title?: string
  folderId?: string | null
  content?: string
  /** Format, zu dem `content` gehört (undefined = unverändert) */
  format?: NoteFormat
  /** Tresor-Notiz: `content` ist ein Umschlag, der Titel steht verschlüsselt in `titleEnc` – nie Klartext */
  vault?: boolean
  titleEnc?: string
  /** Server-Version, auf der der Entwurf basiert */
  baseVersion: number | null
  /** Nach einem Konflikt bewusst „Meine Version“ gewählt – der Server sichert seinen Stand dann im Verlauf */
  overwrite?: boolean
  rev: number
  updatedAt: number
}

type DraftPatch = Partial<Pick<Draft, 'title' | 'content' | 'format' | 'folderId' | 'titleEnc' | 'vault'>>

export type SyncState ='saved' | 'pending' | 'saving' | 'offline' | 'conflict' | 'error'

export type NoteSyncStatus = {
  state: SyncState
  error?: string
  /** Bei Konflikt: aktuelle Version auf dem Server */
  serverNote?: Note
}

type SavedListener = (note: Note, info: { linksUpdated: number; linksSkipped: number; created: boolean }) => void

const SAVE_DELAY = 900
const RETRY_INTERVAL = 20_000

const SAVED: NoteSyncStatus = { state: 'saved' }

/** Titel der Kopie, die bei „Beide behalten“ entsteht */
export function conflictCopyTitle(title: string): string {
  const stamp = new Date().toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }).replace(/[:/]/g, '-')
  return `${title} (Konflikt ${stamp})`
}

export class SyncStore {
  private storageKey = ''
  private drafts = new Map<string, Draft>()
  private status = new Map<string, NoteSyncStatus>()
  private versions = new Map<string, number>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private inflight = new Set<string>()
  private resend = new Set<string>()
  private listeners = new Set<() => void>()
  private savedListeners = new Set<SavedListener>()
  private snapshot: Draft[] = []
  private retryTimer: ReturnType<typeof setInterval> | null = null
  private started = false
  /** In dieser Sitzung angelegte Notizen – auch wenn sie schon gespeichert sind, bevor der Editor erscheint */
  private created = new Set<string>()
  /** Notiz, die gerade im Editor offen ist (Konflikte dort nicht automatisch lösen) */
  activeId: string | null = null
  /** Der lokale Speicher ist voll: Entwürfe liegen nur im Arbeitsspeicher, bis das Schreiben wieder klappt */
  private memoryOnly = false

  start(userId: number) {
    if (this.started) return
    this.started = true
    this.storageKey = `noted:drafts:${userId}`
    try {
      const raw = localStorage.getItem(this.storageKey)
      const list: Draft[] = raw ? JSON.parse(raw) : []
      for (const d of list) {
        this.drafts.set(d.id, d)
        this.status.set(d.id, { state: 'pending' })
      }
    } catch {
      /* defekter Speicher – ignorieren */
    }
    this.emit()
    window.addEventListener('online', () => this.flushAll())
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flushAll(true)
      else this.flushAll()
    })
    this.retryTimer = setInterval(() => {
      if (this.drafts.size > 0) this.flushAll()
    }, RETRY_INTERVAL)
    // Nach dem Start alte Entwürfe nachsenden
    setTimeout(() => this.flushAll(), 500)
  }

  // ---- Abonnements (für useSyncExternalStore) ----

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  onSaved(fn: SavedListener): () => void {
    this.savedListeners.add(fn)
    return () => {
      this.savedListeners.delete(fn)
    }
  }

  private emit() {
    this.snapshot = [...this.drafts.values()]
    for (const fn of this.listeners) fn()
  }

  getDrafts = () => this.snapshot

  getDraft(id: string) {
    return this.drafts.get(id)
  }

  getStatus(id: string): NoteSyncStatus {
    return this.status.get(id) ?? SAVED
  }

  wasCreatedHere(id: string) {
    return this.created.has(id)
  }

  hasPending() {
    return this.drafts.size > 0
  }

  /** Entwürfe nur im Arbeitsspeicher, weil der lokale Speicher voll ist – sie gehen verloren, wenn der Tab schließt */
  isMemoryOnly() {
    return this.memoryOnly
  }

  private persist() {
    if (!this.storageKey) return
    try {
      if (this.drafts.size === 0) localStorage.removeItem(this.storageKey)
      else localStorage.setItem(this.storageKey, JSON.stringify([...this.drafts.values()]))
      this.setMemoryOnly(false)
    } catch {
      // Kein Fehlerzustand der Entwürfe: Senden geht weiterhin und ist jetzt die einzige Sicherung
      this.setMemoryOnly(true)
    }
  }

  private setMemoryOnly(on: boolean) {
    if (on === this.memoryOnly) return
    this.memoryOnly = on
    if (on) window.addEventListener('beforeunload', this.warnBeforeUnload)
    else window.removeEventListener('beforeunload', this.warnBeforeUnload)
  }

  /** Nur solange Entwürfe ausschließlich im Arbeitsspeicher liegen: vor dem Schließen des Tabs warnen */
  private warnBeforeUnload = (e: BeforeUnloadEvent) => {
    if (this.drafts.size > 0) e.preventDefault()
  }

  private setStatus(id: string, s: NoteSyncStatus) {
    this.status.set(id, s)
  }

  /** Bekannte Server-Version einer Notiz merken (Basis für Konflikterkennung). */
  setKnownVersion(id: string, version: number) {
    const current = this.versions.get(id)
    if (current === undefined || version > current) this.versions.set(id, version)
  }

  // ---- Änderungen ----

  /** Neue Notiz anlegen (funktioniert auch offline). */
  create(input: {
    id: string
    title: string
    folderId: string | null
    content: string
    format: NoteFormat
    vault?: boolean
    titleEnc?: string
  }) {
    const draft: Draft = { ...input, isNew: true, baseVersion: null, rev: 1, updatedAt: Date.now() }
    this.drafts.set(input.id, draft)
    this.created.add(input.id)
    this.setStatus(input.id, { state: 'pending' })
    this.persist()
    this.emit()
    return this.flush(input.id)
  }

  /** Änderung an einer Notiz vormerken. `version` ist die Server-Version, auf der sie basiert. */
  update(id: string, version: number, patch: DraftPatch, opts: { immediate?: boolean } = {}) {
    this.updateMany([{ id, version, patch }], opts)
  }

  /** Wie `update` für mehrere Notizen – der lokale Speicher wird dabei nur einmal geschrieben. */
  updateMany(changes: { id: string; version: number; patch: DraftPatch }[], opts: { immediate?: boolean } = {}) {
    if (changes.length === 0) return
    for (const { id, version, patch } of changes) this.mergeDraft(id, version, patch)
    this.persist()
    this.emit()
    for (const { id } of changes) this.schedule(id, opts.immediate ? 0 : SAVE_DELAY)
  }

  private mergeDraft(id: string, version: number, patch: DraftPatch) {
    const existing = this.drafts.get(id)
    const draft: Draft = existing
      ? { ...existing, ...patch, rev: existing.rev + 1, updatedAt: Date.now() }
      : {
          id,
          isNew: false,
          ...patch,
          baseVersion: Math.max(this.versions.get(id) ?? 0, version),
          rev: 1,
          updatedAt: Date.now(),
        }
    this.drafts.set(id, draft)
    const st = this.getStatus(id).state
    if (st !== 'conflict' && st !== 'saving') this.setStatus(id, { state: 'pending' })
  }

  private schedule(id: string, delay: number) {
    clearTimeout(this.timers.get(id))
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id)
        void this.flush(id)
      }, delay),
    )
  }

  /** Alle offenen Entwürfe sofort senden. */
  flushAll(keepalive = false) {
    for (const id of this.drafts.keys()) {
      const st = this.getStatus(id).state
      if (st === 'conflict' || st === 'error') continue
      clearTimeout(this.timers.get(id))
      this.timers.delete(id)
      void this.flush(id, keepalive)
    }
  }

  async flush(id: string, keepalive = false): Promise<void> {
    if (this.inflight.has(id)) {
      this.resend.add(id)
      return
    }
    const draft = this.drafts.get(id)
    if (!draft) return
    this.inflight.add(id)
    this.setStatus(id, { state: 'saving' })
    this.emit()
    const sentRev = draft.rev
    try {
      let note: Note
      let linksUpdated = 0
      let linksSkipped = 0
      if (draft.isNew) {
        const res = await api<{ note: Note }>('/api/notes', {
          method: 'POST',
          body: {
            id: draft.id,
            title: draft.vault ? draft.id : (draft.title ?? 'Unbenannt'),
            folderId: draft.folderId ?? null,
            content: draft.content ?? '',
            format: draft.format ?? 'markdown',
            titleEnc: draft.titleEnc,
          },
          keepalive,
        })
        note = res.note
      } else {
        const res = await api<{ note: Note; linksUpdated: number; linksSkipped?: number }>(`/api/notes/${id}`, {
          method: 'PUT',
          body: {
            title: draft.title,
            titleEnc: draft.titleEnc,
            folderId: draft.folderId,
            content: draft.content,
            format: draft.format,
            baseVersion: draft.baseVersion ?? undefined,
            autoRename: true,
            reason: draft.overwrite ? 'conflict' : undefined,
          },
          keepalive,
        })
        note = res.note
        linksUpdated = res.linksUpdated
        linksSkipped = res.linksSkipped ?? 0
      }
      this.setKnownVersion(id, note.version)
      const current = this.drafts.get(id)
      if (current && current.rev === sentRev) {
        this.drafts.delete(id)
        this.setStatus(id, SAVED)
      } else if (current) {
        // Während des Speicherns wurde weitergeschrieben
        current.isNew = false
        current.baseVersion = note.version
        delete current.overwrite
        if (current.title !== undefined && current.title === draft.title) current.title = note.title
        this.setStatus(id, { state: 'pending' })
        this.schedule(id, SAVE_DELAY)
      }
      this.persist()
      for (const fn of this.savedListeners) fn(note, { linksUpdated, linksSkipped, created: draft.isNew })
    } catch (err) {
      if (err instanceof NetworkError) {
        this.setStatus(id, { state: 'offline' })
      } else if (err instanceof ApiError && err.code === 'version_conflict') {
        const serverNote = err.body.note as Note
        this.setKnownVersion(id, serverNote.version)
        this.setStatus(id, { state: 'conflict', serverNote })
        // Eine Tresor-Notiz lässt sich nur entsperrt kopieren (neue ID, also neu verschlüsseln) – der Konflikt bleibt
        if (this.activeId !== id && !draft.vault) await this.resolveConflict(id, 'copy')
      } else if (err instanceof ApiError && err.status === 404 && !draft.isNew) {
        this.setStatus(id, { state: 'error', error: 'Die Notiz wurde auf einem anderen Gerät gelöscht.' })
      } else {
        this.setStatus(id, { state: 'error', error: errorMessage(err) })
      }
    } finally {
      this.inflight.delete(id)
      this.emit()
      if (this.resend.delete(id)) void this.flush(id)
    }
  }

  /**
   * Konflikt auflösen:
   *  - mine:   eigene Version speichern (überschreibt die Server-Version)
   *  - theirs: Server-Version übernehmen, eigenen Entwurf verwerfen
   *  - copy:   Server-Version behalten und eigene Version als Kopie anlegen
   */
  async resolveConflict(id: string, mode: 'mine' | 'theirs' | 'copy') {
    const draft = this.drafts.get(id)
    const status = this.getStatus(id)
    const serverNote = status.serverNote
    // Kopie einer Tresor-Notiz legt die Notizansicht verschlüsselt an (der Umschlag gehört zur alten ID)
    if (!draft || (mode === 'copy' && draft.vault)) return
    if (mode === 'mine' && serverNote) {
      draft.baseVersion = serverNote.version
      draft.overwrite = true
      this.setStatus(id, { state: 'pending' })
      this.persist()
      this.emit()
      return this.flush(id)
    }
    this.drafts.delete(id)
    this.setStatus(id, SAVED)
    this.persist()
    this.emit()
    if (serverNote) for (const fn of this.savedListeners) fn(serverNote, { linksUpdated: 0, linksSkipped: 0, created: false })
    if (mode === 'copy') {
      if (draft.content !== undefined) {
        await this.create({
          id: crypto.randomUUID(),
          title: conflictCopyTitle(draft.title ?? serverNote?.title ?? 'Notiz'),
          folderId: draft.folderId ?? serverNote?.folderId ?? null,
          content: draft.content,
          format: draft.format ?? serverNote?.format ?? 'markdown',
        })
      }
    }
  }

  /**
   * Klartext-Entwurf zu einer Notiz, die inzwischen im Tresor liegt, durch seine verschlüsselte Fassung ersetzen –
   * der Server lehnt Klartext dort ab
   */
  sealDraft(id: string, sealed: { titleEnc?: string; content?: string }) {
    const draft = this.drafts.get(id)
    if (!draft || draft.vault) return
    const next: Draft = { ...draft, vault: true, title: undefined, rev: draft.rev + 1, updatedAt: Date.now() }
    if (sealed.titleEnc !== undefined) next.titleEnc = sealed.titleEnc
    if (sealed.content !== undefined) next.content = sealed.content
    this.drafts.set(id, next)
    if (this.getStatus(id).state === 'error') this.setStatus(id, { state: 'pending' })
    this.persist()
    this.emit()
    this.schedule(id, 0)
  }

  /** Entwurf als neue Notiz anlegen (z. B. wenn das Original auf dem Server gelöscht wurde). */
  recreate(id: string, fallback: { title: string; folderId: string | null; content: string; format: NoteFormat }) {
    const draft = this.drafts.get(id)
    clearTimeout(this.timers.get(id))
    this.drafts.delete(id)
    this.setStatus(id, SAVED)
    return this.create({
      id: crypto.randomUUID(),
      title: draft?.title ?? fallback.title,
      folderId: draft?.folderId !== undefined ? draft.folderId : fallback.folderId,
      content: draft?.content ?? fallback.content,
      format: draft?.format ?? fallback.format,
    })
  }

  /** Entwurf verwerfen (z. B. wenn die Notiz gelöscht wurde). */
  discard(id: string) {
    clearTimeout(this.timers.get(id))
    this.drafts.delete(id)
    this.setStatus(id, SAVED)
    this.persist()
    this.emit()
  }

  /** Beim Abmelden: alles lokal Gespeicherte entfernen. */
  clearAll() {
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
    this.drafts.clear()
    this.status.clear()
    if (this.storageKey) localStorage.removeItem(this.storageKey)
    this.setMemoryOnly(false)
    if (this.retryTimer) clearInterval(this.retryTimer)
    this.emit()
  }
}

export const sync = new SyncStore()
