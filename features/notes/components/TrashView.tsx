'use client'
import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FileText, Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { Page, PageHeader } from '@/shared/ui/page-layout'
import { useApp } from '@/features/workspace/client/context'
import { graphKey } from '@/features/graph/client/queries'
import { Button } from '@/shared/ui/button'
import { ConfirmModal } from '@/shared/ui/modal'
import { MenuItem, MenuSeparator, useContextMenu } from '@/shared/ui/menu'
import { useToast } from '@/shared/ui/toast'
import { cn } from '@/shared/ui/cn'
import { api, errorMessage } from '@/shared/client/api'
import { keys, useTrash } from '../client/queries'
import { notesLabel, postNoteBatch } from '../client/bulk'
import { useListSelection } from '@/shared/client/list-selection'
import { formatRelative } from '@/shared/lib/format'
import { SelectButton, SelectionBar, SelectionCheckbox, SelectionMenuItems, type SelectionAction } from '@/shared/ui/selection-bar'
import { NOTES_NOUN } from './SelectionBar'
import { MAX_BATCH_NOTES } from '../limits'
import type { TrashedNote } from '../types'

export function TrashView() {
  const app = useApp()
  const qc = useQueryClient()
  const toast = useToast()
  const { data: notes = [], isLoading } = useTrash()
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const [busy, setBusy] = useState(false)
  // Endgültig löschen lässt sich nicht rückgängig machen – daher wie beim Leeren erst nachfragen
  const [removeTarget, setRemoveTarget] = useState<{ notes: TrashedNote[]; fromSelection: boolean } | null>(null)
  const openContextMenu = useContextMenu()
  const order = notes.map((n) => n.id)
  const root = useRef<HTMLDivElement>(null)
  const selection = useListSelection({ order, resetKey: 'trash', root })
  const selected = notes.filter((n) => selection.ids.has(n.id))

  async function refresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: keys.trash }),
      qc.invalidateQueries({ queryKey: keys.notes }),
      qc.invalidateQueries({ queryKey: keys.tags }),
      qc.invalidateQueries({ queryKey: graphKey }),
    ])
  }

  async function restore(list: TrashedNote[], fromSelection = false) {
    setBusy(true)
    try {
      const ids = await postNoteBatch('restore', list.map((n) => n.id))
      await refresh()
      if (fromSelection) selection.stop()
      const restored = list.filter((n) => ids.includes(n.id))
      if (restored.length === 1) {
        const { id } = restored[0]
        toast.show(`${notesLabel(restored)} wiederhergestellt.`, {
          tone: 'success',
          action: { label: 'Öffnen', onClick: () => app.go({ kind: 'note', id }) },
        })
      } else if (restored.length > 1) {
        toast.success(`${notesLabel(restored)} wiederhergestellt.`)
      }
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove(target: { notes: TrashedNote[]; fromSelection: boolean }) {
    setBusy(true)
    try {
      await postNoteBatch('delete', target.notes.map((n) => n.id))
      await refresh()
      if (target.fromSelection) selection.stop()
      setRemoveTarget(null)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const actions: SelectionAction[] = [
    { key: 'restore', label: 'Wiederherstellen', icon: <RotateCcw />, run: () => void restore(selected, true) },
    {
      key: 'delete',
      label: 'Endgültig löschen …',
      icon: <Trash2 />,
      danger: true,
      run: () => setRemoveTarget({ notes: selected, fromSelection: true }),
    },
  ]

  return (
    <Page>
      <div ref={root}>
        <PageHeader
          title="Papierkorb"
          subtitle="Nach 30 Tagen endgültig gelöscht."
          actions={
            notes.length > 0 ? (
              <>
                <SelectButton selection={selection} />
                <Button variant="danger" size="sm" onClick={() => setConfirmEmpty(true)}>
                  Leeren
                </Button>
              </>
            ) : null
          }
        />
        {isLoading ? (
          <Loader2 className="mx-auto size-6 animate-spin text-faint" />
        ) : notes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-strong px-6 py-12 text-center text-muted">Der Papierkorb ist leer.</div>
        ) : (
          <>
            <SelectionBar selection={selection} actions={actions} max={MAX_BATCH_NOTES} noun={NOTES_NOUN} />
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-elevated">
              {notes.map((n) => {
                const checked = selection.ids.has(n.id)
                return (
                  <li
                    key={n.id}
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 select-none',
                      selection.active && 'cursor-pointer',
                      checked && 'bg-accent-soft',
                    )}
                    // Die Zeilen sind keine Links: Im Auswahlmodus schaltet ein Klick um, sonst Strg/⌘- und Umschalt-Klick
                    onClick={(e) => {
                      if (!selection.active && !e.ctrlKey && !e.metaKey && !e.shiftKey) return
                      if (e.target instanceof Element && e.target.closest('button')) return
                      selection.click(n.id, order, e)
                    }}
                    onContextMenu={(e) =>
                      openContextMenu(
                        e,
                        checked && selection.ids.size >= 2 ? (
                          <SelectionMenuItems selection={selection} actions={actions} max={MAX_BATCH_NOTES} noun={NOTES_NOUN} />
                        ) : (
                          <>
                            <MenuItem icon={<RotateCcw />} onSelect={() => void restore([n])} disabled={busy}>
                              Wiederherstellen
                            </MenuItem>
                            <MenuSeparator />
                            <MenuItem
                              icon={<Trash2 />}
                              danger
                              onSelect={() => setRemoveTarget({ notes: [n], fromSelection: false })}
                              disabled={busy}
                            >
                              Endgültig löschen …
                            </MenuItem>
                          </>
                        ),
                      )
                    }
                  >
                    {selection.active ? (
                      <SelectionCheckbox title={n.title} checked={checked} onToggle={(e) => selection.click(n.id, order, e)} />
                    ) : (
                      <FileText className="size-4 shrink-0 text-faint" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{n.title}</p>
                      <p className="text-xs text-faint">gelöscht {formatRelative(n.deletedAt)}</p>
                    </div>
                    {selection.active ? null : (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => restore([n])}
                          disabled={busy}
                          title="Wiederherstellen"
                          aria-label={`„${n.title}“ wiederherstellen`}
                        >
                          <RotateCcw className="size-4" /> <span className="max-sm:hidden">Wiederherstellen</span>
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => setRemoveTarget({ notes: [n], fromSelection: false })}
                          disabled={busy}
                          aria-label={`„${n.title}“ endgültig löschen`}
                          title="Endgültig löschen"
                        >
                          <Trash2 className="size-4 text-danger" />
                        </Button>
                      </>
                    )}
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
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
            selection.stop()
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
        description={
          removeTarget
            ? `${notesLabel(removeTarget.notes)} ${removeTarget.notes.length === 1 ? 'wird' : 'werden'} endgültig gelöscht. Das kann nicht rückgängig gemacht werden.`
            : null
        }
        confirmLabel="Endgültig löschen"
        danger
        loading={!!removeTarget && busy}
        onConfirm={() => removeTarget && void remove(removeTarget)}
      />
    </Page>
  )
}
