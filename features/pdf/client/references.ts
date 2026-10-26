'use client'
// Rückverweise im PDF-Viewer: welche Notizen dieses PDF bzw. einzelne Seiten zitieren
import { useQuery } from '@tanstack/react-query'
import { api } from '@/shared/client/api'
import { attachmentsKey } from '@/features/attachments/client/queries'
import type { FileReference } from '@/features/attachments/types'

/** Notizen, die auf das PDF verweisen – erst geladen, wenn `enabled` (Seitenleiste offen), dann bei jedem Öffnen neu */
export function usePdfReferences(attachmentId: string | null, enabled: boolean) {
  return useQuery({
    // Unter attachmentsKey: Was die Dateiliste neu lädt, lädt auch die Rückverweise neu
    queryKey: [...attachmentsKey, attachmentId, 'references'],
    queryFn: () => api<{ notes: FileReference[] }>(`/api/attachments/${attachmentId}/references`).then((r) => r.notes),
    enabled: enabled && !!attachmentId,
    // Verweise ändern sich beim Schreiben in Notizen
    staleTime: 0,
  })
}
