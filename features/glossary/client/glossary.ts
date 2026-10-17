'use client'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/shared/client/api'
import type { Glossary } from '../types'

/** Glossar aller Notizen oder eines Ordners – wird bei jedem Öffnen neu berechnet */
export function useGlossary(folderId: string | null) {
  return useQuery({
    queryKey: ['glossary', folderId ?? 'all'],
    queryFn: () => api<Glossary>(`/api/glossary${folderId ? `?folder=${encodeURIComponent(folderId)}` : ''}`),
    staleTime: 0,
  })
}
