'use client'
// Tresor-Notizen im Browser: vor dem Speichern verschlüsseln (je Notiz der Reihe nach, damit die Entwürfe in der
// Reihenfolge des Tippens ankommen), zum Anzeigen entschlüsseln und über die Grenze des Tresors verschieben.
// Der Sync-Store sieht nur Umschläge – im localStorage liegt so auch offline kein Klartext.
import { useEffect, useState } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { api } from '@/shared/client/api'
import { sync } from '@/features/notes/client/sync'
import { applySavedNote, keys } from '@/features/notes/client/queries'
import { graphKey } from '@/features/graph/client/queries'
import { flashcardsKey } from '@/features/flashcards/client/flashcards'
import type { Note, NoteFormat } from '@/features/notes/types'
import { VaultError } from '../crypto'
import { isEnvelope, useVaultState, vault } from './vault'

const queues = new Map<string, Promise<unknown>>()
/**
 * Zuletzt gespeicherter Klartext je Notiz. Jeder Umschlag ist anders (frischer IV) – ohne Vergleich zählte jedes
 * Speichern als Änderung und erhöhte die Version.
 */
const lastPlain = new Map<string, { title?: string; content?: string }>()
/** Sprungziel beim Öffnen einer Tresor-Notiz – Überschriften kommen nicht in die Adresse (Browserverlauf) */
const pendingHeadings = new Map<string, string>()

function enqueue(id: string, task: () => Promise<void>): Promise<void> {
  const next = (queues.get(id) ?? Promise.resolve()).catch(() => {}).then(task)
  queues.set(id, next)
  void next
    .catch(() => {})
    .finally(() => {
      if (queues.get(id) === next) queues.delete(id)
    })
  return next
}

export function rememberPlain(id: string, title: string, content: string) {
  lastPlain.set(id, { title, content })
}

export function setPendingHeading(id: string, heading: string) {
  pendingHeadings.set(id, heading)
}

export function pendingHeading(id: string): string | undefined {
  return pendingHeadings.get(id)
}

export function clearPendingHeading(id: string) {
  pendingHeadings.delete(id)
}

/** Neue Tresor-Notiz – erst verschlüsselt, dann als Entwurf angelegt (geht auch offline) */
export async function createVaultNote(input: {
  id?: string
  title: string
  folderId: string
  content: string
  format: NoteFormat
}): Promise<string> {
  const id = input.id ?? crypto.randomUUID()
  const [titleEnc, content] = await Promise.all([
    vault.encrypt(id, 'title', input.title),
    vault.encrypt(id, 'content', input.content),
  ])
  rememberPlain(id, input.title, input.content)
  void sync.create({ id, title: id, folderId: input.folderId, content, format: input.format, vault: true, titleEnc })
  return id
}

/** Änderung an einer Tresor-Notiz: Geänderte Felder werden verschlüsselt und wie gewohnt synchronisiert */
export function updateVaultNote(
  id: string,
  version: number,
  patch: { title?: string; content?: string; format?: NoteFormat; folderId?: string },
  opts: { immediate?: boolean } = {},
): Promise<void> {
  return enqueue(id, async () => {
    const prev = lastPlain.get(id) ?? {}
    const out: { titleEnc?: string; content?: string; format?: NoteFormat; folderId?: string } = {}
    if (patch.title !== undefined && patch.title !== prev.title) {
      out.titleEnc = await vault.encrypt(id, 'title', patch.title)
    }
    if (patch.content !== undefined && (patch.content !== prev.content || patch.format !== undefined)) {
      out.content = await vault.encrypt(id, 'content', patch.content)
    }
    if (patch.format !== undefined) out.format = patch.format
    if (patch.folderId !== undefined) out.folderId = patch.folderId
    if (Object.keys(out).length === 0) return
    lastPlain.set(id, { title: patch.title ?? prev.title, content: patch.content ?? prev.content })
    sync.update(id, version, { ...out, vault: true }, opts)
  })
}

/** Unterordner im Tresor anlegen – der Name geht nur verschlüsselt (mit der vorab vergebenen ID) zum Server */
export async function createVaultFolder(name: string, parentId: string) {
  const id = crypto.randomUUID()
  const nameEnc = await vault.encrypt(id, 'name', name)
  await api('/api/folders', { method: 'POST', body: { id, name: id, parentId, nameEnc } })
}

export async function renameVaultFolder(id: string, name: string) {
  const nameEnc = await vault.encrypt(id, 'name', name)
  await api(`/api/folders/${id}`, { method: 'PATCH', body: { nameEnc } })
}

/** Titel und Inhalt einer Tresor-Notiz entschlüsseln */
export async function revealNote(note: Note): Promise<Note> {
  if (!note.vault) return note
  const [title, content] = await Promise.all([
    note.titleEnc ? vault.decrypt({ id: note.id, field: 'title', envelope: note.titleEnc }) : Promise.resolve(''),
    vault.decrypt({ id: note.id, field: 'content', envelope: note.content }),
  ])
  return { ...note, title, content }
}

type RevealedNote =
  | { state: 'locked' }
  | { state: 'loading' }
  | { state: 'corrupt'; message: string }
  | { state: 'ready'; note: Note; server: Note | null }

/**
 * Tresor-Notiz zum Bearbeiten: einmal beim Öffnen entschlüsselt, samt eigenem Entwurf (danach verwaltet der Editor
 * den Inhalt selbst). Neuere Stände vom Server werden im Hintergrund nachgezogen.
 */
export function useRevealedNote(note: Note | null, server: Note | null): RevealedNote {
  const { unlocked, epoch } = useVaultState()
  const [initial, setInitial] = useState<{ key: string; value: Note | VaultError } | null>(null)
  const [plainServer, setPlainServer] = useState<Note | null>(null)
  const key = note ? `${note.id}|${epoch}` : ''

  useEffect(() => {
    if (!unlocked || !note) return
    let cancelled = false
    const draft = sync.getDraft(note.id)
    // Entwurf von vor dem Verschieben in den Tresor (anderes Gerät): Klartext, wird im Hintergrund verschlüsselt
    const plainDraft = draft && !draft.vault ? draft : null
    const current: Note = {
      ...note,
      titleEnc: draft?.titleEnc ?? note.titleEnc,
      content: isEnvelope(draft?.content) ? draft.content : note.content,
      format: draft?.format ?? note.format,
      folderId: draft?.folderId !== undefined ? draft.folderId : note.folderId,
    }
    revealNote(current)
      .then((revealed) => {
        const plain = {
          ...revealed,
          title: plainDraft?.title ?? revealed.title,
          content: plainDraft?.content ?? revealed.content,
        }
        if (!plainDraft) rememberPlain(plain.id, plain.title, plain.content)
        if (!cancelled) setInitial({ key, value: plain })
      })
      .catch((err: unknown) => {
        if (!cancelled) setInitial({ key, value: err instanceof VaultError ? err : new VaultError('corrupt') })
      })
    return () => {
      cancelled = true
    }
    // Nur beim Öffnen (je Notiz und Entsperren) – danach gehört der Inhalt dem Editor
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, key])

  useEffect(() => {
    if (!unlocked || !server?.vault) return
    let cancelled = false
    revealNote(server)
      .then((plain) => {
        if (!cancelled) setPlainServer(plain)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [unlocked, server])

  if (!unlocked) return { state: 'locked' }
  if (!initial || initial.key !== key) return { state: 'loading' }
  if (initial.value instanceof VaultError) return { state: 'corrupt', message: initial.value.message }
  return { state: 'ready', note: initial.value, server: plainServer }
}

/** Was nach einem Wechsel über die Grenze außerhalb des Tresors anders aussieht */
function refreshOutside(qc: QueryClient) {
  for (const queryKey of [keys.tags, keys.trash, graphKey, flashcardsKey, ['search'], ['glossary'], ['backlinks']]) {
    void qc.invalidateQueries({ queryKey })
  }
}

/** Vor dem Verschieben müssen offene Änderungen gesendet sein – sonst gingen sie im Klartext hinterher */
async function settled(id: string) {
  if (sync.getDraft(id)) await sync.flush(id)
  if (sync.getDraft(id)) {
    throw new Error(
      'Die Notiz hat noch nicht gespeicherte Änderungen. Versuche es noch einmal, wenn sie gespeichert sind.',
    )
  }
}

/** Notiz in den Tresor: im Browser verschlüsseln, der Server entfernt Verlauf, Freigaben, Index, Tags und Links */
export async function moveNoteIntoVault(qc: QueryClient, id: string, folderId: string, deleteCards: boolean) {
  await settled(id)
  const { note } = await api<{ note: Note }>(`/api/notes/${id}`)
  const [titleEnc, content] = await Promise.all([
    vault.encrypt(id, 'title', note.title),
    vault.encrypt(id, 'content', note.content),
  ])
  const res = await api<{ note: Note; cards: number }>(`/api/vault/notes/${id}`, {
    method: 'POST',
    body: { action: 'move-in', folderId, baseVersion: note.version, titleEnc, content, deleteCards },
  })
  rememberPlain(id, note.title, note.content)
  sync.setKnownVersion(id, res.note.version)
  applySavedNote(qc, res.note)
  refreshOutside(qc)
  await purgeCachedPlaintext([id])
  return res
}

/** Notiz aus dem Tresor: entschlüsselt zurück – danach ist sie wieder durchsuchbar */
export async function moveNoteOutOfVault(qc: QueryClient, id: string, folderId: string | null) {
  await settled(id)
  const { note } = await api<{ note: Note }>(`/api/notes/${id}`)
  const plain = await revealNote(note)
  const res = await api<{ note: Note }>(`/api/vault/notes/${id}`, {
    method: 'POST',
    body: { action: 'move-out', folderId, baseVersion: note.version, title: plain.title, content: plain.content },
  })
  lastPlain.delete(id)
  sync.setKnownVersion(id, res.note.version)
  applySavedNote(qc, res.note)
  refreshOutside(qc)
  return res.note
}

/**
 * Klartext, den der Service Worker vor dem Verschieben in den Tresor zwischengespeichert hat (auch auf anderen
 * Geräten), entfernen – samt Glossar, Graph und Tags, die ihn enthalten konnten. `true`, wenn etwas gefunden wurde.
 */
export async function purgeCachedPlaintext(ids: string[]): Promise<boolean> {
  if (ids.length === 0 || !('caches' in window)) return false
  try {
    const cache = await caches.open('noted-data')
    let found = false
    for (const id of ids) {
      const res = await cache.match(`/api/notes/${id}`)
      if (!res) continue
      const data = (await res.json().catch(() => null)) as { note?: Note } | null
      if (!isEnvelope(data?.note?.content)) {
        await cache.delete(`/api/notes/${id}`)
        found = true
      }
    }
    if (found) for (const path of ['/api/glossary', '/api/graph', '/api/tags']) await cache.delete(path)
    return found
  } catch {
    return false
  }
}

/**
 * Entwürfe im Klartext zu Notizen, die inzwischen (auf einem anderen Gerät) in den Tresor kamen, verschlüsseln – der
 * Server lehnt sie sonst ab (vault_required). Läuft nach dem Entsperren und wenn die Notizliste neu kommt.
 */
export async function sealPlainDrafts(vaultIds: Set<string>) {
  if (!vault.unlocked) return
  for (const draft of sync.getDrafts()) {
    if (draft.vault || !vaultIds.has(draft.id)) continue
    const id = draft.id
    await enqueue(id, async () => {
      const titleEnc = draft.title !== undefined ? await vault.encrypt(id, 'title', draft.title) : undefined
      const content = draft.content !== undefined ? await vault.encrypt(id, 'content', draft.content) : undefined
      sync.sealDraft(id, { titleEnc, content })
    })
  }
}
