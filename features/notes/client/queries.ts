'use client'
import { useMemo, useSyncExternalStore } from 'react'
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { api } from '@/shared/client/api'
import { sync, type Draft } from './sync'
import type { Folder, Note, NoteSummary, NoteVersion, NoteVersionWithContent, TagCount, TrashedNote } from '../types'
import { extractTags, makeExcerpt } from '@/shared/markdown/meta'
import { noteText } from '../format'
import { useRevealRequest, useVaultState, vault, type Reveal } from '@/features/vault/client/vault'
import { VaultError } from '@/features/vault/crypto'

export const keys = {
  notes: ['notes'] as const,
  note: (id: string) => ['note', id] as const,
  folders: ['folders'] as const,
  tags: ['tags'] as const,
  trash: ['trash'] as const,
  search: (q: string) => ['search', q] as const,
  backlinks: (id: string) => ['backlinks', id] as const,
  versions: (id: string) => ['versions', id] as const,
  version: (id: string, versionId: number) => ['versions', id, versionId] as const,
}

type VaultState = ReturnType<typeof useVaultState>

/** Entschlüsselter Titel bzw. Name – solange er noch entschlüsselt wird „…“ */
function revealed(reveal: Reveal): string {
  const value = vault.peek(reveal)
  return typeof value === 'string' ? value : value instanceof VaultError ? 'Beschädigt' : '…'
}

/** Gesperrt bleibt vom Tresor nur der Wurzelordner „Tresor“ sichtbar, entsperrt kommen die echten Namen dazu */
function revealFolders(folders: Folder[], state: VaultState): Folder[] {
  if (!folders.some((f) => f.vault)) return folders
  if (!state.unlocked) return folders.filter((f) => !f.vault || f.nameEnc === null)
  return folders.map((f) =>
    f.nameEnc ? { ...f, name: revealed({ id: f.id, field: 'name', envelope: f.nameEnc }) } : f,
  )
}

/** Tresor-Notizen gibt es nur entsperrt – dann mit ihrem echten Titel */
function revealNotes(notes: NoteSummary[], state: VaultState): NoteSummary[] {
  if (!notes.some((n) => n.vault)) return notes
  if (!state.unlocked) return notes.filter((n) => !n.vault)
  return notes.map((n) =>
    n.vault && n.titleEnc ? { ...n, title: revealed({ id: n.id, field: 'title', envelope: n.titleEnc }) } : n,
  )
}

const titleReveals = (items: { id: string; vault: boolean; titleEnc: string | null }[]): Reveal[] =>
  items.flatMap((n) => (n.vault && n.titleEnc ? [{ id: n.id, field: 'title' as const, envelope: n.titleEnc }] : []))

export function useFolders() {
  const query = useQuery({
    queryKey: keys.folders,
    queryFn: () => api<{ folders: Folder[] }>('/api/folders').then((r) => r.folders),
  })
  const state = useVaultState()
  const reveals = useMemo(
    () =>
      (query.data ?? []).flatMap((f) => (f.nameEnc ? [{ id: f.id, field: 'name' as const, envelope: f.nameEnc }] : [])),
    [query.data],
  )
  useRevealRequest(reveals)
  const data = useMemo(() => query.data && revealFolders(query.data, state), [query.data, state])
  return { ...query, data }
}

function useServerNotes() {
  return useQuery({
    queryKey: keys.notes,
    queryFn: () => api<{ notes: NoteSummary[] }>('/api/notes').then((r) => r.notes),
  })
}

/** IDs der Tresor-Notizen – auch gesperrt (zum Aufräumen von Klartext auf diesem Gerät) */
export function useVaultNoteIds(): string[] {
  const { data } = useServerNotes()
  const joined = useMemo(() => (data ?? []).flatMap((n) => (n.vault ? [n.id] : [])).join(','), [data])
  return useMemo(() => (joined ? joined.split(',') : []), [joined])
}

export function useDrafts(): Draft[] {
  return useSyncExternalStore(sync.subscribe, sync.getDrafts, () => EMPTY)
}
const EMPTY: Draft[] = []

/**
 * Notizliste vom Server, ergänzt um lokale (noch nicht synchronisierte) Änderungen – Tresor-Notizen nur entsperrt,
 * mit entschlüsseltem Titel.
 */
export function useNotes() {
  const query = useServerNotes()
  const drafts = useDrafts()
  const state = useVaultState()
  const merged = useMemo(() => mergeDrafts(query.data ?? [], drafts), [query.data, drafts])
  const reveals = useMemo(() => titleReveals(merged), [merged])
  useRevealRequest(reveals)
  const notes = useMemo(() => revealNotes(merged, state), [merged, state])
  return { ...query, notes }
}

function mergeDrafts(server: NoteSummary[], drafts: Draft[]): NoteSummary[] {
  if (drafts.length === 0) return server
  const byId = new Map(drafts.map((d) => [d.id, d]))
  const result = server.map((n) => {
    const d = byId.get(n.id)
    if (!d) return n
    byId.delete(n.id)
    const format = d.format ?? n.format
    // Im Tresor ist der Inhalt ein Umschlag: kein Auszug, keine Tags
    const text = d.content !== undefined && !n.vault ? noteText(format, d.content) : null
    return {
      ...n,
      title: d.title ?? n.title,
      titleEnc: d.titleEnc ?? n.titleEnc,
      folderId: d.folderId !== undefined ? d.folderId : n.folderId,
      format,
      updatedAt: Math.max(n.updatedAt, d.updatedAt),
      ...(text !== null ? { excerpt: makeExcerpt(text), tags: extractTags(text) } : {}),
    }
  })
  for (const d of byId.values()) {
    if (!d.isNew) continue
    const format = d.format ?? 'markdown'
    const text = d.vault ? '' : noteText(format, d.content ?? '')
    result.unshift({
      id: d.id,
      title: d.vault ? d.id : (d.title ?? 'Unbenannt'),
      folderId: d.folderId ?? null,
      format,
      pinned: false,
      version: 0,
      createdAt: d.updatedAt,
      updatedAt: d.updatedAt,
      tags: extractTags(text),
      excerpt: makeExcerpt(text),
      vault: !!d.vault,
      titleEnc: d.titleEnc ?? null,
    })
  }
  return result
}

export function useNote(id: string | null, enabled = true) {
  return useQuery({
    queryKey: keys.note(id ?? ''),
    queryFn: () => api<{ note: Note }>(`/api/notes/${id}`).then((r) => r.note),
    enabled: !!id && enabled,
    staleTime: 0,
  })
}

export function useTags() {
  return useQuery({
    queryKey: keys.tags,
    queryFn: () => api<{ tags: TagCount[] }>('/api/tags').then((r) => r.tags),
  })
}

/** Papierkorb – Tresor-Notizen gesperrt als „Gesperrte Notiz“, entsperrt mit ihrem Titel */
export function useTrash() {
  const query = useQuery({
    queryKey: keys.trash,
    queryFn: () => api<{ notes: TrashedNote[] }>('/api/trash').then((r) => r.notes),
  })
  const state = useVaultState()
  const reveals = useMemo(() => titleReveals(query.data ?? []), [query.data])
  useRevealRequest(reveals)
  const data = useMemo(
    () =>
      query.data?.map((n) =>
        !n.vault
          ? n
          : {
              ...n,
              title:
                state.unlocked && n.titleEnc
                  ? revealed({ id: n.id, field: 'title', envelope: n.titleEnc })
                  : 'Gesperrte Notiz',
            },
      ),
    [query.data, state],
  )
  return { ...query, data }
}

export function useBacklinks(id: string | null) {
  return useQuery({
    queryKey: keys.backlinks(id ?? ''),
    queryFn: () =>
      api<{ backlinks: { id: string; title: string; folderId: string | null }[] }>(`/api/notes/${id}/backlinks`).then(
        (r) => r.backlinks,
      ),
    enabled: !!id,
  })
}

/**
 * Gesicherte Stände einer Notiz – bei jedem Öffnen des Verlaufs neu laden, es kann inzwischen einer dazugekommen sein.
 * Im Tresor mit entschlüsseltem Titel.
 */
export function useNoteVersions(id: string, enabled: boolean) {
  const query = useQuery({
    queryKey: keys.versions(id),
    queryFn: () => api<{ versions: NoteVersion[] }>(`/api/notes/${id}/versions`).then((r) => r.versions),
    enabled,
    staleTime: 0,
  })
  const state = useVaultState()
  const reveals = useMemo(
    () =>
      (query.data ?? []).flatMap((v) => (v.titleEnc ? [{ id, field: 'title' as const, envelope: v.titleEnc }] : [])),
    [query.data, id],
  )
  useRevealRequest(reveals)
  const data = useMemo(
    () =>
      query.data?.map((v) =>
        v.titleEnc
          ? { ...v, title: state.unlocked ? revealed({ id, field: 'title', envelope: v.titleEnc }) : 'Gesperrt' }
          : v,
      ),
    [query.data, state, id],
  )
  return { ...query, data }
}

export function useNoteVersion(id: string, versionId: number | null) {
  return useQuery({
    queryKey: keys.version(id, versionId ?? 0),
    queryFn: () =>
      api<{ version: NoteVersionWithContent }>(`/api/notes/${id}/versions/${versionId}`).then((r) => r.version),
    enabled: versionId !== null,
    // Ein gesicherter Stand ändert sich nicht mehr
    staleTime: Infinity,
  })
}

/** Gespeicherte Notiz in die Caches übernehmen. */
export function applySavedNote(qc: QueryClient, note: Note) {
  qc.setQueryData<Note>(keys.note(note.id), note)
  qc.setQueryData<NoteSummary[]>(keys.notes, (list) => {
    if (!list) return list
    const { content: _content, ...summary } = note // eslint-disable-line @typescript-eslint/no-unused-vars
    const idx = list.findIndex((n) => n.id === note.id)
    if (idx < 0) return [summary, ...list]
    const copy = list.slice()
    copy[idx] = summary
    return copy
  })
}

export function removeNoteFromCache(qc: QueryClient, id: string) {
  qc.setQueryData<NoteSummary[]>(keys.notes, (list) => list?.filter((n) => n.id !== id))
  qc.removeQueries({ queryKey: keys.note(id) })
}
