'use client'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/shared/client/api'
import type { Attachment, FileEntry } from '../types'

export const attachmentsKey = ['attachments'] as const

/** Abfrage der Dateien – auch für `queryClient.fetchQuery` außerhalb von Komponenten (z. B. für Seitenbilder) */
export const attachmentsQuery = {
  queryKey: attachmentsKey,
  queryFn: () => api<{ attachments: Attachment[] }>('/api/attachments').then((r) => r.attachments),
}

export function useAttachments() {
  return useQuery(attachmentsQuery)
}

/** Dateien samt den Notizen, die sie einbetten – für den Bereich „Dateien“ (fällt unter attachmentsKey) */
export function useFiles() {
  return useQuery({
    queryKey: [...attachmentsKey, 'notes'],
    queryFn: () => api<{ attachments: FileEntry[] }>('/api/attachments?notes=1').then((r) => r.attachments),
    // Einbettungen ändern sich beim Schreiben in Notizen – beim Öffnen immer neu laden
    staleTime: 0,
    // Solange Dateien für die Suche gelesen werden, den Stand nachladen
    refetchInterval: (query) => (query.state.data?.some((f) => f.search?.state === 'pending') ? 3_000 : false),
  })
}
