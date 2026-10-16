'use client'
import { useMemo, useState } from 'react'
import {
  ChevronRight,
  FileText,
  Folder as FolderIcon,
  FolderOpen,
  FolderInput,
  FolderPlus,
  List,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Trash2,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useApp } from './context'
import { Menu, MenuItem, MenuSeparator } from '../ui/menu'
import { useToast } from '../ui/toast'
import { cn } from '../ui/cn'
import { buildTree, folderPath, type FolderNode } from '@/lib/client/tree'
import { keys, useFolders, useNotes } from '@/lib/client/queries'
import { usePref } from '@/lib/client/prefs'
import { sync } from '@/lib/client/sync'
import { api, errorMessage } from '@/lib/client/api'
import type { NoteSummary } from '@/lib/shared/types'

const DND_TYPE = 'application/x-noted'
type DragData = { kind: 'note'; id: string; version: number } | { kind: 'folder'; id: string }

function useExpanded() {
  const [raw, setRaw] = usePref<string>('noted:expanded', '[]')
  const set = useMemo(() => {
    try {
      return new Set<string>(JSON.parse(raw))
    } catch {
      return new Set<string>()
    }
  }, [raw])
  const toggle = (id: string, open?: boolean) => {
    const next = new Set(set)
    if (open ?? !next.has(id)) next.add(id)
    else next.delete(id)
    setRaw(JSON.stringify([...next]))
  }
  return { expanded: set, toggle }
}

export function FolderTree() {
  const app = useApp()
  const qc = useQueryClient()
  const toast = useToast()
  const { notes, isLoading } = useNotes()
  const { data: folders = [] } = useFolders()
  const { expanded, toggle } = useExpanded()
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const tree = useMemo(() => buildTree(folders, notes), [folders, notes])

  const activeNoteId = app.view.kind === 'note' ? app.view.id : null
  const activeFolderId = app.view.kind === 'folder' ? app.view.id : null
  // Ordner der aktiven Notiz automatisch aufklappen
  const activeAncestors = useMemo(() => {
    const note = activeNoteId ? notes.find((n) => n.id === activeNoteId) : null
    return new Set(folderPath(folders, note?.folderId ?? null).map((f) => f.id))
  }, [activeNoteId, notes, folders])

  async function handleDrop(e: React.DragEvent, folderId: string | null) {
    e.preventDefault()
    setDropTarget(null)
    let data: DragData
    try {
      data = JSON.parse(e.dataTransfer.getData(DND_TYPE))
    } catch {
      return
    }
    if (data.kind === 'note') {
      sync.update(data.id, data.version, { folderId }, { immediate: true })
    } else if (data.id !== folderId) {
      try {
        await api(`/api/folders/${data.id}`, { method: 'PATCH', body: { parentId: folderId } })
        await qc.invalidateQueries({ queryKey: keys.folders })
      } catch (err) {
        toast.error(errorMessage(err))
      }
    }
    if (folderId) toggle(folderId, true)
  }

  const dropProps = (folderId: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DND_TYPE)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDropTarget(folderId ?? 'root')
    },
    onDragLeave: () => setDropTarget((t) => (t === (folderId ?? 'root') ? null : t)),
    onDrop: (e: React.DragEvent) => handleDrop(e, folderId),
  })

  function renderNote(note: NoteSummary, depth: number) {
    const active = note.id === activeNoteId
    return (
      <div
        key={note.id}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DND_TYPE, JSON.stringify({ kind: 'note', id: note.id, version: note.version }))
          e.dataTransfer.effectAllowed = 'move'
        }}
        className={cn(
          'group flex items-center rounded-md pr-1 transition-colors',
          active ? 'bg-active text-fg' : 'text-muted hover:bg-hover hover:text-fg',
        )}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <button
          type="button"
          onClick={() => app.go({ kind: 'note', id: note.id })}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-[18px] text-left text-sm"
          title={note.title}
        >
          <FileText className="size-4 shrink-0 opacity-70" />
          <span className={cn('truncate', active && 'font-medium')}>{note.title}</span>
          {note.pinned ? <Pin className="size-3 shrink-0 text-accent-text" /> : null}
        </button>
        <NoteMenu note={note} />
      </div>
    )
  }

  function renderFolder(node: FolderNode) {
    const open = expanded.has(node.id) || activeAncestors.has(node.id)
    const count = node.notes.length
    return (
      <div key={node.id}>
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DND_TYPE, JSON.stringify({ kind: 'folder', id: node.id }))
            e.dataTransfer.effectAllowed = 'move'
          }}
          {...dropProps(node.id)}
          className={cn(
            'group flex items-center rounded-md pr-1 transition-colors',
            activeFolderId === node.id ? 'bg-active text-fg' : 'text-muted hover:bg-hover hover:text-fg',
            dropTarget === node.id && 'ring-2 ring-accent ring-inset',
          )}
          style={{ paddingLeft: 8 + node.depth * 14 }}
        >
          <button
            type="button"
            onClick={() => toggle(node.id, !open)}
            className="flex min-w-0 flex-1 items-center gap-1 py-1.5 text-left text-sm"
            aria-expanded={open}
          >
            <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
            {open ? <FolderOpen className="size-4 shrink-0 text-muted" /> : <FolderIcon className="size-4 shrink-0 text-muted" />}
            <span className="ml-1 truncate font-medium text-fg/90">{node.name}</span>
            {!open && count > 0 ? <span className="ml-1 text-xs text-faint">{count}</span> : null}
          </button>
          <FolderMenu node={node} />
        </div>
        {open ? (
          <div>
            {node.children.map(renderFolder)}
            {node.notes.map((n) => renderNote(n, node.depth + 1))}
            {node.children.length === 0 && node.notes.length === 0 ? (
              <div className="py-1 text-xs text-faint italic" style={{ paddingLeft: 34 + (node.depth + 1) * 14 }}>
                Leer
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  if (isLoading && notes.length === 0) {
    return (
      <div className="space-y-2 px-2.5 py-1">
        {[70, 55, 80, 60].map((w, i) => (
          <div key={i} className="h-4 animate-pulse rounded bg-hover" style={{ width: `${w}%` }} />
        ))}
      </div>
    )
  }

  return (
    <div
      {...dropProps(null)}
      className={cn('min-h-16 rounded-lg', dropTarget === 'root' && 'ring-2 ring-accent ring-inset')}
    >
      {tree.roots.map(renderFolder)}
      {tree.rootNotes.map((n) => renderNote(n, 0))}
      {tree.roots.length === 0 && tree.rootNotes.length === 0 ? (
        <p className="px-2.5 py-2 text-sm text-faint">Noch keine Notizen.</p>
      ) : null}
    </div>
  )
}

function NoteMenu({ note }: { note: NoteSummary }) {
  const app = useApp()
  return (
    <Menu
      trigger={(p) => (
        <button
          type="button"
          {...p}
          className="flex size-6 items-center justify-center rounded-md text-faint opacity-0 group-hover:opacity-100 hover:bg-bg hover:text-fg focus:opacity-100 aria-expanded:opacity-100 max-lg:opacity-60"
          aria-label="Aktionen"
        >
          <MoreHorizontal className="size-4" />
        </button>
      )}
    >
      <MenuItem icon={<Pencil />} onSelect={() => app.renameNote(note)}>
        Umbenennen
      </MenuItem>
      <MenuItem icon={<FolderInput />} onSelect={() => app.openMove({ kind: 'note', note })}>
        Verschieben …
      </MenuItem>
      <MenuItem icon={note.pinned ? <PinOff /> : <Pin />} onSelect={() => app.togglePin(note)}>
        {note.pinned ? 'Lösen' : 'Anheften'}
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<Trash2 />} danger onSelect={() => app.trashNote(note)}>
        In den Papierkorb
      </MenuItem>
    </Menu>
  )
}

function FolderMenu({ node }: { node: FolderNode }) {
  const app = useApp()
  return (
    <Menu
      trigger={(p) => (
        <button
          type="button"
          {...p}
          className="flex size-6 items-center justify-center rounded-md text-faint opacity-0 group-hover:opacity-100 hover:bg-bg hover:text-fg focus:opacity-100 aria-expanded:opacity-100 max-lg:opacity-60"
          aria-label="Ordner-Aktionen"
        >
          <MoreHorizontal className="size-4" />
        </button>
      )}
    >
      <MenuItem icon={<Plus />} onSelect={() => app.openNewNote({ folderId: node.id })}>
        Neue Notiz hier
      </MenuItem>
      <MenuItem icon={<FolderPlus />} onSelect={() => app.openNewFolder(node.id)}>
        Neuer Unterordner
      </MenuItem>
      <MenuItem icon={<List />} onSelect={() => app.go({ kind: 'folder', id: node.id })}>
        Als Liste anzeigen
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<Pencil />} onSelect={() => app.openRenameFolder(node)}>
        Umbenennen
      </MenuItem>
      <MenuItem icon={<FolderInput />} onSelect={() => app.openMove({ kind: 'folder', folder: node })}>
        Verschieben …
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<Trash2 />} danger onSelect={() => app.deleteFolder(node)}>
        Löschen
      </MenuItem>
    </Menu>
  )
}
