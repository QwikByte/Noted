'use client'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FileText, Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { Page, PageHeader } from '@/shared/ui/page-layout'
import { useApp } from '@/features/workspace/client/context'
import { Button } from '@/shared/ui/button'
import { ConfirmModal } from '@/shared/ui/modal'
import { MenuItem, MenuSeparator, useContextMenu } from '@/shared/ui/menu'
import { useToast } from '@/shared/ui/toast'
import { api, errorMessage } from '@/shared/client/api'
import { keys, useTrash } from '../client/queries'
import { formatRelative } from '@/shared/lib/format'

export function TrashView() {
  const app = useApp()
  const qc = useQueryClient()
  const toast = useToast()
  const { data: notes = [], isLoading } = useTrash()
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  // Endgültig löschen lässt sich nicht rückgängig machen – daher wie beim Leeren erst nachfragen
  const [removeTarget, setRemoveTarget] = useState<{ id: string; title: string } | null>(null)
  const openContextMenu = useContextMenu()

  async function restore(id: string) {
    setBusy(id)
    try {
      const res = await api<{ note: { id: string; title: string } }>(`/api/notes/${id}/restore`, { method: 'POST' })
      await Promise.all([qc.invalidateQueries({ queryKey: keys.trash }), qc.invalidateQueries({ queryKey: keys.notes }), qc.invalidateQueries({ queryKey: keys.tags })])
      toast.show(`„${res.note.title}“ wiederhergestellt.`, { tone: 'success', action: { label: 'Öffnen', onClick: () => app.go({ kind: 'note', id }) } })
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function remove(id: string) {
    setBusy(id)
    try {
      await api(`/api/notes/${id}?permanent=1`, { method: 'DELETE' })
      await qc.invalidateQueries({ queryKey: keys.trash })
      setRemoveTarget(null)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Page>
      <PageHeader
        title="Papierkorb"
        subtitle="Nach 30 Tagen endgültig gelöscht."
        actions={
          notes.length > 0 ? (
            <Button variant="danger" size="sm" onClick={() => setConfirmEmpty(true)}>
              Leeren
            </Button>
          ) : null
        }
      />
      {isLoading ? (
        <Loader2 className="mx-auto size-6 animate-spin text-faint" />
      ) : notes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-strong px-6 py-12 text-center text-muted">Der Papierkorb ist leer.</div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-elevated">
          {notes.map((n) => (
            <li
              key={n.id}
              className="flex items-center gap-3 px-4 py-3"
              onContextMenu={(e) =>
                openContextMenu(
                  e,
                  <>
                    <MenuItem icon={<RotateCcw />} onSelect={() => void restore(n.id)} disabled={busy === n.id}>
                      Wiederherstellen
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem icon={<Trash2 />} danger onSelect={() => setRemoveTarget({ id: n.id, title: n.title })} disabled={busy === n.id}>
                      Endgültig löschen …
                    </MenuItem>
                  </>,
                )
              }
            >
              <FileText className="size-4 shrink-0 text-faint" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{n.title}</p>
                <p className="text-xs text-faint">gelöscht {formatRelative(n.deletedAt)}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => restore(n.id)}
                disabled={busy === n.id}
                title="Wiederherstellen"
                aria-label={`„${n.title}“ wiederherstellen`}
              >
                <RotateCcw className="size-4" /> <span className="max-sm:hidden">Wiederherstellen</span>
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => setRemoveTarget({ id: n.id, title: n.title })}
                disabled={busy === n.id}
                aria-label={`„${n.title}“ endgültig löschen`}
                title="Endgültig löschen"
              >
                <Trash2 className="size-4 text-danger" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmModal
        open={confirmEmpty}
        onClose={() => setConfirmEmpty(false)}
        title="Papierkorb leeren?"
        description={`${notes.length} ${notes.length === 1 ? 'Notiz wird' : 'Notizen werden'} endgültig gelöscht. Das kann nicht rückgängig gemacht werden.`}
        confirmLabel="Endgültig löschen"
        danger
        onConfirm={async () => {
          try {
            await api('/api/trash', { method: 'DELETE' })
            await qc.invalidateQueries({ queryKey: keys.trash })
            toast.success('Papierkorb geleert.')
          } catch (err) {
            toast.error(errorMessage(err))
          }
          setConfirmEmpty(false)
        }}
      />
      <ConfirmModal
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        title="Endgültig löschen?"
        description={removeTarget ? `„${removeTarget.title}“ wird endgültig gelöscht. Das kann nicht rückgängig gemacht werden.` : null}
        confirmLabel="Endgültig löschen"
        danger
        loading={!!removeTarget && busy === removeTarget.id}
        onConfirm={() => removeTarget && void remove(removeTarget.id)}
      />
    </Page>
  )
}
