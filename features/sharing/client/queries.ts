'use client'
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { api } from '@/shared/client/api'
import type { Share, ShareExpiry } from '../types'

const sharesKey = ['shares'] as const

/** Gültige Links – alle des Kontos oder nur die einer Notiz */
export function useShares(noteId?: string) {
  return useQuery({
    queryKey: noteId ? [...sharesKey, noteId] : sharesKey,
    queryFn: () => api<{ shares: Share[] }>(noteId ? `/api/notes/${noteId}/shares` : '/api/shares').then((r) => r.shares),
    // Aufrufe zählen mit – beim Öffnen immer frisch
    staleTime: 0,
  })
}

/** Link erstellen – `url` mit dem Token gibt es nur hier */
export async function createShare(qc: QueryClient, noteId: string, expiresInDays: ShareExpiry) {
  const res = await api<{ share: Share; url: string }>(`/api/notes/${noteId}/shares`, {
    method: 'POST',
    body: { expiresInDays },
  })
  await qc.invalidateQueries({ queryKey: sharesKey })
  return res
}

export async function revokeShare(qc: QueryClient, id: string) {
  await api(`/api/shares/${id}`, { method: 'DELETE' })
  await qc.invalidateQueries({ queryKey: sharesKey })
}
