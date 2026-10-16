'use client'
import { useMemo, useSyncExternalStore } from 'react'
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { api } from '@/shared/client/api'
import { sync, type Draft } from './sync'
import type { Folder, Note, NoteSummary, TagCount, TrashedNote } from '../types'
import { extractTags, makeExcerpt } from '@/shared/markdown/meta'

export const keys = {
  notes: ['notes'] as const,
  note: (id: string) => ['note', id] as const,
  folders: ['folders'] as const,
  tags: ['tags'] as const,
  trash: ['trash'] as const,
  search: (q: string) => ['search', q] as const,
  backlinks: (id: string) => ['backlinks', id] as const,
}

export function useFolders() {
  return useQuery({
    queryKey: keys.folders,
    queryFn: () => api<{ folders: Folder[] }>('/api/folders').then((r) => r.folders),
  })
}

function useServerNotes() {
  return useQuery({
    queryKey: keys.notes,
    queryFn: () => api<{ notes: NoteSummary[] }>('/api/notes').then((r) => r.notes),
  })
}

export function useDrafts(): Draft[] {
  return useSyncExternalStore(sync.subscribe, sync.getDrafts, () => EMPTY)
}
const EMPTY: Draft[] = []

/** Notizliste vom Server, ergänzt um lokale (noch nicht synchronisierte) Änderungen. */
export function useNotes() {
  const query = useServerNotes()
  const drafts = useDrafts()
  const notes = useMemo(() => mergeDrafts(query.data ?? [], drafts), [query.data, drafts])
  return { ...query, notes }
}

function mergeDrafts(server: NoteSummary[], drafts: Draft[]): NoteSummary[] {
  if (drafts.length === 0) return server
  const byId = new Map(drafts.map((d) => [d.id, d]))
  const result = server.map((n) => {
    const d = byId.get(n.id)
    if (!d) return n
    byId.delete(n.id)
    return {
      ...n,
      title: d.title ?? n.title,
      folderId: d.folderId !== undefined ? d.folderId : n.folderId,
      updatedAt: Math.max(n.updatedAt, d.updatedAt),
      ...(d.content !== undefined ? { excerpt: makeExcerpt(d.content), tags: extractTags(d.content) } : {}),
    }
  })
  for (const d of byId.values()) {
    if (!d.isNew) continue
    result.unshift({
      id: d.id,
      title: d.title ?? 'Unbenannt',
      folderId: d.folderId ?? null,
      pinned: false,
      version: 0,
      createdAt: d.updatedAt,
      updatedAt: d.updatedAt,
      tags: extractTags(d.content ?? ''),
      excerpt: makeExcerpt(d.content ?? ''),
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

export function useTrash() {
  return useQuery({
    queryKey: keys.trash,
    queryFn: () => api<{ notes: TrashedNote[] }>('/api/trash').then((r) => r.notes),
  })
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
