'use client'
// Anmerkungen in PDFs. Neue, geänderte und gelöschte liegen bis zum Senden im localStorage – so entstehen
// Markierungen auch offline. Die Ansicht zeigt den Stand des Servers mit diesen Änderungen darüber.
// Mehrere Tabs teilen sich den Speicher: Jede Änderung liest ihn frisch und schreibt ihn zurück.
import { useMemo, useSyncExternalStore } from 'react'
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/shared/client/api'
import type { PdfAnnotation } from '../types'

type Deletion = { id: string; attachmentId: string }
type Stored = { upserts: PdfAnnotation[]; deletes: Deletion[] }
type AnnotationList = { annotations: PdfAnnotation[] }

const EMPTY: Stored = { upserts: [], deletes: [] }
/** Anmerkungen je Anfrage – klein genug, dass auch lange Kommentare unter der Größengrenze bleiben */
const CHUNK = 100

const annotationsKey = (attachmentId: string) => ['pdf-annotations', attachmentId] as const

/** Abgelehnt (ungültig, zu groß) oder das PDF gibt es nicht mehr: nicht erneut senden, sonst hinge es ewig fest */
const isFinal = (err: unknown) => err instanceof ApiError && [400, 404, 413].includes(err.status)

class AnnotationStore {
  private key = ''
  private state: Stored = EMPTY
  private listeners = new Set<() => void>()
  private flushing = false
  private again = false
  private started = false
  private qc: QueryClient | null = null

  start(userId: number, qc: QueryClient) {
    this.qc = qc
    if (this.started) return
    this.started = true
    this.key = `noted:pdf:annotations:${userId}`
    this.state = this.read()
    window.addEventListener('storage', (e) => {
      if (e.key !== this.key) return
      this.state = this.read()
      this.emit()
    })
    window.addEventListener('online', () => void this.flush())
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.flush()
    })
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
      return {
        upserts: Array.isArray(raw?.upserts) ? raw.upserts : [],
        deletes: Array.isArray(raw?.deletes) ? raw.deletes : [],
      }
    } catch {
      return EMPTY
    }
  }

  /** Frisch lesen, ändern, zurückschreiben – so geht nichts aus anderen Tabs verloren */
  private update(fn: (s: Stored) => Stored) {
    const next = fn(this.key ? this.read() : this.state)
    if (this.key) {
      try {
        if (next.upserts.length === 0 && next.deletes.length === 0) localStorage.removeItem(this.key)
        else localStorage.setItem(this.key, JSON.stringify(next))
      } catch {
        /* voll – bleibt im Arbeitsspeicher */
      }
    }
    this.state = next
    this.emit()
  }

  /** Neue Markierung – ID und Zeit vergibt das Gerät, damit sie auch offline entstehen kann */
  create(input: Omit<PdfAnnotation, 'id' | 'createdAt' | 'updatedAt'>): PdfAnnotation {
    const now = Date.now()
    const annotation = { ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now }
    this.save(annotation)
    return annotation
  }

  /** Anmerkung anlegen oder ändern (updatedAt setzt der Aufrufer) */
  save(annotation: PdfAnnotation) {
    this.update((s) => ({
      upserts: [...s.upserts.filter((a) => a.id !== annotation.id), annotation],
      deletes: s.deletes.filter((d) => d.id !== annotation.id),
    }))
    void this.flush()
  }

  remove(annotation: Pick<PdfAnnotation, 'id' | 'attachmentId'>) {
    this.update((s) => ({
      upserts: s.upserts.filter((a) => a.id !== annotation.id),
      deletes: [...s.deletes.filter((d) => d.id !== annotation.id), { id: annotation.id, attachmentId: annotation.attachmentId }],
    }))
    void this.flush()
  }

  /** Gesammelte Änderungen senden – erst alle Anlagen/Änderungen je PDF, dann die Löschungen */
  async flush(): Promise<void> {
    if (!this.key) return
    if (this.flushing) {
      this.again = true
      return
    }
    this.flushing = true
    try {
      do {
        this.again = false
        const { upserts, deletes } = this.read()
        for (const attachmentId of new Set(upserts.map((a) => a.attachmentId))) {
          const list = upserts.filter((a) => a.attachmentId === attachmentId)
          for (let i = 0; i < list.length; i += CHUNK) {
            const batch = list.slice(i, i + CHUNK)
            try {
              await api(`/api/attachments/${attachmentId}/annotations`, { method: 'PUT', body: { annotations: batch } })
              this.patchCache(attachmentId, (all) => [...all.filter((a) => !batch.some((b) => b.id === a.id)), ...batch])
            } catch (err) {
              if (!isFinal(err)) return
            }
            this.sent(batch)
          }
        }
        for (const d of deletes) {
          try {
            await api(`/api/attachments/${d.attachmentId}/annotations/${d.id}`, { method: 'DELETE' })
          } catch (err) {
            if (!isFinal(err)) return
          }
          this.patchCache(d.attachmentId, (all) => all.filter((a) => a.id !== d.id))
          this.update((s) => ({ ...s, deletes: s.deletes.filter((x) => x.id !== d.id) }))
        }
      } while (this.again)
    } finally {
      this.flushing = false
    }
  }

  /** Gesendete aus der Warteschlange nehmen – außer sie wurden inzwischen erneut geändert */
  private sent(batch: PdfAnnotation[]) {
    const versions = new Map(batch.map((a) => [a.id, a.updatedAt]))
    this.update((s) => ({ ...s, upserts: s.upserts.filter((a) => versions.get(a.id) !== a.updatedAt) }))
  }

  /** Ergebnis gleich in den Cache übernehmen, damit die Ansicht beim Leeren der Warteschlange nicht flackert */
  private patchCache(attachmentId: string, fn: (all: PdfAnnotation[]) => PdfAnnotation[]) {
    this.qc?.setQueryData<AnnotationList>(annotationsKey(attachmentId), (cur) => cur && { annotations: fn(cur.annotations) })
  }

  clearAll() {
    if (this.key) localStorage.removeItem(this.key)
    this.state = EMPTY
    this.emit()
  }
}

export const pdfAnnotations = new AnnotationStore()

/** Anmerkungen eines PDFs – vom Server, mit den noch nicht gesendeten Änderungen dieses Geräts */
export function useAnnotations(attachmentId: string | null): { annotations: PdfAnnotation[]; isLoading: boolean } {
  const query = useQuery({
    queryKey: annotationsKey(attachmentId ?? ''),
    queryFn: () => api<AnnotationList>(`/api/attachments/${attachmentId}/annotations`),
    enabled: !!attachmentId,
  })
  const local = useSyncExternalStore(pdfAnnotations.subscribe, pdfAnnotations.getSnapshot, () => EMPTY)
  return useMemo(() => {
    if (!attachmentId) return { annotations: [], isLoading: false }
    const changed = local.upserts.filter((a) => a.attachmentId === attachmentId)
    const hidden = new Set([...local.deletes.map((d) => d.id), ...changed.map((a) => a.id)])
    const annotations = [...(query.data?.annotations ?? []).filter((a) => !hidden.has(a.id)), ...changed]
    return { annotations, isLoading: query.isLoading }
  }, [attachmentId, query.data, query.isLoading, local])
}
