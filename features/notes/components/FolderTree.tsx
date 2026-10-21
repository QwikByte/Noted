'use client'
import { useEffect, useMemo } from 'react'
import { ChevronRight, FileText, Folder as FolderIcon, FolderOpen, MoreHorizontal, Pin } from 'lucide-react'
import { useApp } from '@/features/workspace/client/context'
import { Menu, useContextMenu } from '@/shared/ui/menu'
import { cn } from '@/shared/ui/cn'
import { buildTree, folderPath, type FolderNode } from '../tree'
import { useFolders, useNotes } from '../client/queries'
import { useExpanded } from '../client/expanded'
import { ROOT, startDrag, useDraggedId, useDropTarget } from '../client/drag'
import type { NoteSummary } from '../types'
import { FolderMenuItems, NoteMenuItems } from './ItemMenus'

/** Zugeklappter Ordner, über dem beim Ziehen so lange verweilt wird, klappt auf */
const EXPAND_DELAY_MS = 600

export function FolderTree() {
  const app = useApp()
  const { notes, isLoading } = useNotes()
  const { data: folders = [] } = useFolders()
  const { expanded, toggle } = useExpanded()
  const dropTarget = useDropTarget()
  const dragged = useDraggedId()
  const tree = useMemo(() => buildTree(folders, notes), [folders, notes])
  const openContextMenu = useContextMenu()

  const activeNoteId = app.view.kind === 'note' ? app.view.id : null
  const activeFolderId = app.view.kind === 'folder' ? app.view.id : null
  // Ordner der aktiven Notiz automatisch aufklappen
  const activeAncestors = useMemo(() => {
    const note = activeNoteId ? notes.find((n) => n.id === activeNoteId) : null
    return new Set(folderPath(folders, note?.folderId ?? null).map((f) => f.id))
  }, [activeNoteId, notes, folders])

  // Beim Ziehen über einem zugeklappten Ordner verweilen klappt ihn auf
  useEffect(() => {
    if (!dropTarget || dropTarget === ROOT || expanded.has(dropTarget)) return
    const timer = setTimeout(() => toggle(dropTarget, true), EXPAND_DELAY_MS)
    return () => clearTimeout(timer)
  }, [dropTarget, expanded, toggle])

  function renderNote(note: NoteSummary, depth: number) {
    const active = note.id === activeNoteId
    return (
      <div
        key={note.id}
        className={cn(
          'group flex items-center rounded-md pr-1 transition-colors',
          active ? 'bg-active text-fg' : 'text-muted hover:bg-hover hover:text-fg',
          dragged === note.id && 'opacity-50',
        )}
        style={{ paddingLeft: 8 + depth * 14 }}
        onContextMenu={(e) => openContextMenu(e, <NoteMenuItems note={note} context />)}
      >
        <button
          type="button"
          onClick={() => app.go({ kind: 'note', id: note.id })}
          onPointerDown={(e) => startDrag(e, { kind: 'note', id: note.id, title: note.title })}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-[18px] text-left text-sm select-none [-webkit-touch-callout:none]"
          title={note.title}
          aria-current={active ? 'page' : undefined}
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
    // Der ganze Block (Ordner samt Inhalt) ist Ablageziel – so landet eine Notiz, die auf eine andere Notiz im Ordner
    // gezogen wird, in diesem Ordner
    return (
      <div
        key={node.id}
        data-drop-folder={node.id}
        // Outline statt Ring: Sie liegt über den Hintergründen der Zeilen darin
        className={cn('rounded-md', dropTarget === node.id && 'bg-accent-soft outline-2 -outline-offset-2 outline-accent')}
      >
        <div
          className={cn(
            'group flex items-center rounded-md pr-1 transition-colors',
            activeFolderId === node.id ? 'bg-active text-fg' : 'text-muted hover:bg-hover hover:text-fg',
            dragged === node.id && 'opacity-50',
          )}
          style={{ paddingLeft: 8 + node.depth * 14 }}
          onContextMenu={(e) => openContextMenu(e, <FolderMenuItems folder={node} context />)}
        >
          <button
            type="button"
            onClick={() => toggle(node.id, !open)}
            onPointerDown={(e) => startDrag(e, { kind: 'folder', id: node.id, name: node.name })}
            className="flex min-w-0 flex-1 items-center gap-1 py-1.5 text-left text-sm select-none [-webkit-touch-callout:none]"
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
      data-drop-folder={ROOT}
      data-testid="folder-tree"
      className={cn('min-h-16 rounded-lg', dropTarget === ROOT && 'outline-2 -outline-offset-2 outline-accent')}
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
      <NoteMenuItems note={note} />
    </Menu>
  )
}

function FolderMenu({ node }: { node: FolderNode }) {
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
      <FolderMenuItems folder={node} />
    </Menu>
  )
}
