'use client'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { FileText, Folder as FolderIcon } from 'lucide-react'
import { useToast } from '@/shared/ui/toast'
import { api, errorMessage } from '@/shared/client/api'
import { registerDropHandler, ROOT, useDragState, type DragItem } from '../client/drag'
import { useExpanded } from '../client/expanded'
import { keys, useFolders, useNotes } from '../client/queries'
import { sync } from '../client/sync'
import { canMoveTo } from '../tree'

/** Vorschau am Zeiger beim Ziehen – und das eigentliche Verschieben beim Ablegen */
export function DragLayer() {
  const drag = useDragState()
  const qc = useQueryClient()
  const toast = useToast()
  const { notes } = useNotes()
  const { data: folders = [] } = useFolders()
  const { toggle } = useExpanded()
  const latest = useRef({ notes, folders, toggle })
  useEffect(() => {
    latest.current = { notes, folders, toggle }
  })

  useEffect(() => {
    const folderOf = (target: string) => (target === ROOT ? null : target)

    async function moveFolder(id: string, parentId: string | null) {
      await api(`/api/folders/${id}`, { method: 'PATCH', body: { parentId } })
      await qc.invalidateQueries({ queryKey: keys.folders })
    }

    async function drop(item: DragItem, target: string) {
      const { notes, folders, toggle } = latest.current
      const to = folderOf(target)
      const name = to ? folders.find((f) => f.id === to)?.name : null
      const where = name ? `nach „${name}“` : 'auf die oberste Ebene'
      if (item.kind === 'note') {
        const note = notes.find((n) => n.id === item.id)
        if (!note) return
        const from = note.folderId
        sync.update(note.id, note.version, { folderId: to }, { immediate: true })
        toast.show(`„${note.title}“ ${where} verschoben.`, {
          action: {
            label: 'Rückgängig',
            onClick: () => sync.update(note.id, note.version, { folderId: from }, { immediate: true }),
          },
        })
      } else {
        const folder = folders.find((f) => f.id === item.id)
        if (!folder) return
        const from = folder.parentId
        try {
          await moveFolder(folder.id, to)
          toast.show(`Ordner „${folder.name}“ ${where} verschoben.`, {
            action: {
              label: 'Rückgängig',
              onClick: () => moveFolder(folder.id, from).catch((err) => toast.error(errorMessage(err))),
            },
          })
        } catch (err) {
          toast.error(errorMessage(err))
          return
        }
      }
      if (to) toggle(to, true)
    }

    return registerDropHandler({
      canDrop: (item, target) => canMoveTo(item, folderOf(target), latest.current.notes, latest.current.folders),
      drop: (item, target) => void drop(item, target),
    })
  }, [qc, toast])

  if (!drag) return null
  // Mit dem Finger über dem Zeiger, sonst verdeckt ihn der Finger
  const offset = drag.touch ? { left: drag.x - 24, top: drag.y - 56 } : { left: drag.x + 14, top: drag.y + 10 }
  return createPortal(
    <div
      className="pointer-events-none fixed z-[90] flex max-w-64 items-center gap-2 rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-sm font-medium shadow-pop"
      style={offset}
      data-testid="drag-preview"
    >
      {drag.item.kind === 'note' ? (
        <FileText className="size-4 shrink-0 text-muted" />
      ) : (
        <FolderIcon className="size-4 shrink-0 text-muted" />
      )}
      <span className="truncate">{drag.item.kind === 'note' ? drag.item.title : drag.item.name}</span>
    </div>,
    document.body,
  )
}
