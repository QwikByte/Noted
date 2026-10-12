'use client'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FileText, Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { Page, PageHeader } from './views'
import { useApp } from './context'
import { Button } from '../ui/button'
import { ConfirmModal } from '../ui/modal'
import { useToast } from '../ui/toast'
import { api, errorMessage } from '@/lib/client/api'
import { keys, useTrash } from '@/lib/client/queries'
import { formatRelative } from '@/lib/client/format'

export function TrashView() {
  const app = useApp()
  const qc = useQueryClient()
  const toast = useToast()
  const { data: notes = [], isLoading } = useTrash()
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

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
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Page>
      <PageHeader
        icon={<Trash2 />}
        title="Papierkorb"
        subtitle="Gelöschte Notizen werden nach 30 Tagen endgültig entfernt."
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
        <div className="rounded-2xl border border-dashed border-border px-6 py-12 text-center text-muted">Der Papierkorb ist leer.</div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-elevated">
          {notes.map((n) => (
            <li key={n.id} className="flex items-center gap-3 px-4 py-3">
              <FileText className="size-4 shrink-0 text-faint" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{n.title}</p>
                <p className="text-xs text-faint">gelöscht {formatRelative(n.deletedAt)}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => restore(n.id)} disabled={busy === n.id} title="Wiederherstellen">
                <RotateCcw className="size-4" /> <span className="max-sm:hidden">Wiederherstellen</span>
              </Button>
              <Button size="icon-sm" variant="ghost" onClick={() => remove(n.id)} disabled={busy === n.id} aria-label="Endgültig löschen" title="Endgültig löschen">
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
    </Page>
  )
}
