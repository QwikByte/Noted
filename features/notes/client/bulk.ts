'use client'
// Aktionen für eine oder mehrere Notizen – derselbe Weg für Einzelaktionen und die Mehrfachauswahl
import { useCallback } from 'react'
import { useToast } from '@/shared/ui/toast'
import { api } from '@/shared/client/api'
import { requestVault } from '@/features/vault/client/vault-ui'
import { useFolders } from './queries'
import { sync } from './sync'
import type { NoteBatchAction, NoteBatchResult, NoteSummary } from '../types'

/** Papierkorb, Wiederherstellen, Endgültig löschen, Anheften und Lösen in einer Anfrage – liefert die geänderten IDs */
export async function postNoteBatch(action: NoteBatchAction, ids: string[]): Promise<string[]> {
  const res = await api<NoteBatchResult>('/api/notes/batch', { method: 'POST', body: { action, ids } })
  return res.ids
}

/** „„Titel““ bei einer Notiz, sonst „3 Notizen“ */
export function notesLabel(notes: readonly { title: string }[]): string {
  return notes.length === 1 ? `„${notes[0].title}“` : `${notes.length} Notizen`
}

/**
 * Notizen in einen Ordner verschieben (`null` = oberste Ebene) – über die Entwürfe wie beim Bearbeiten, damit es auch
 * offline klappt. Notizen, die schon dort liegen, werden übersprungen. „Rückgängig“ legt jede in ihren bisherigen Ordner.
 * Über die Grenze des Tresors geht es nur einzeln und über dessen eigenen Dialog (verschlüsseln bzw. entschlüsseln).
 */
export function useMoveNotes() {
  const toast = useToast()
  const { data: folders = [] } = useFolders()
  return useCallback(
    (notes: readonly NoteSummary[], to: string | null) => {
      const moving = notes.filter((n) => n.folderId !== to)
      if (moving.length === 0) return
      const toVault = !!to && !!folders.find((f) => f.id === to)?.vault
      if (moving.some((n) => n.vault !== toVault)) {
        if (moving.length === 1) requestVault({ kind: 'move', note: moving[0], folderId: to })
        else toast.error('In den Tresor und wieder heraus geht es nur Notiz für Notiz.')
        return
      }
      sync.updateMany(
        moving.map((n) => ({ id: n.id, version: n.version, patch: { folderId: to } })),
        { immediate: true },
      )
      const name = to ? folders.find((f) => f.id === to)?.name : null
      const where = name ? `nach „${name}“` : 'auf die oberste Ebene'
      toast.show(`${notesLabel(moving)} ${where} verschoben.`, {
        action: {
          label: 'Rückgängig',
          onClick: () =>
            sync.updateMany(
              moving.map((n) => ({ id: n.id, version: n.version, patch: { folderId: n.folderId } })),
              { immediate: true },
            ),
        },
      })
    },
    [toast, folders],
  )
}
