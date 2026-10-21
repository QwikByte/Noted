'use client'
// Einträge der Menüs für Notizen und Ordner: dieselben im Menü „…“ und beim Rechtsklick (dort mit Öffnen davor)
import { ExternalLink, FileText, FolderInput, FolderOpen, FolderPlus, Link2, List, Pencil, Pin, PinOff, Plus, Search, Trash2 } from 'lucide-react'
import { useApp } from '@/features/workspace/client/context'
import { viewToUrl, type View } from '@/features/workspace/client/nav'
import { MenuItem, MenuSeparator } from '@/shared/ui/menu'
import { useToast } from '@/shared/ui/toast'
import { copyText } from '@/shared/client/clipboard'
import type { Folder, NoteSummary } from '../types'

/** Ansicht öffnen – hier oder in einem neuen Tab (jede Ansicht hat eine eigene Adresse) */
export function OpenViewItems({ view }: { view: View }) {
  const app = useApp()
  return (
    <>
      <MenuItem icon={view.kind === 'folder' ? <FolderOpen /> : <FileText />} onSelect={() => app.go(view)}>
        Öffnen
      </MenuItem>
      <MenuItem icon={<ExternalLink />} onSelect={() => window.open(viewToUrl(view), '_blank', 'noopener')}>
        In neuem Tab öffnen
      </MenuItem>
    </>
  )
}

/** `context`: im Kontextmenü – mit Öffnen und Wikilink */
export function NoteMenuItems({ note, context }: { note: NoteSummary; context?: boolean }) {
  const app = useApp()
  const toast = useToast()
  return (
    <>
      {context ? (
        <>
          <OpenViewItems view={{ kind: 'note', id: note.id }} />
          <MenuSeparator />
        </>
      ) : null}
      <MenuItem icon={<Pencil />} onSelect={() => app.renameNote(note)}>
        Umbenennen
      </MenuItem>
      <MenuItem icon={<FolderInput />} onSelect={() => app.openMove({ kind: 'note', note })}>
        Verschieben …
      </MenuItem>
      <MenuItem icon={note.pinned ? <PinOff /> : <Pin />} onSelect={() => app.togglePin(note)}>
        {note.pinned ? 'Lösen' : 'Anheften'}
      </MenuItem>
      {context ? (
        <MenuItem
          icon={<Link2 />}
          onSelect={async () => {
            if (await copyText(`[[${note.title}]]`)) toast.success('Wikilink kopiert.')
            else toast.error('Kopieren nicht möglich.')
          }}
        >
          Als [[Wikilink]] kopieren
        </MenuItem>
      ) : null}
      <MenuSeparator />
      <MenuItem icon={<Trash2 />} danger onSelect={() => app.trashNote(note)}>
        In den Papierkorb
      </MenuItem>
    </>
  )
}

export function FolderMenuItems({ folder, context }: { folder: Folder; context?: boolean }) {
  const app = useApp()
  return (
    <>
      {context ? (
        <>
          <OpenViewItems view={{ kind: 'folder', id: folder.id }} />
          <MenuSeparator />
        </>
      ) : null}
      <MenuItem icon={<Plus />} onSelect={() => app.openNewNote({ folderId: folder.id })}>
        Neue Notiz hier
      </MenuItem>
      <MenuItem icon={<FolderPlus />} onSelect={() => app.openNewFolder(folder.id)}>
        Neuer Unterordner
      </MenuItem>
      {context ? null : (
        <MenuItem icon={<List />} onSelect={() => app.go({ kind: 'folder', id: folder.id })}>
          Als Liste anzeigen
        </MenuItem>
      )}
      <MenuSeparator />
      <MenuItem icon={<Pencil />} onSelect={() => app.openRenameFolder(folder)}>
        Umbenennen
      </MenuItem>
      <MenuItem icon={<FolderInput />} onSelect={() => app.openMove({ kind: 'folder', folder })}>
        Verschieben …
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<Trash2 />} danger onSelect={() => app.deleteFolder(folder)}>
        Löschen
      </MenuItem>
    </>
  )
}

/**
 * Rechtsklick auf freie Fläche – nicht auf markierten Text, Links oder Bilder: Dafür ist das allgemeine Menü da
 * (Kopieren, Link öffnen).
 */
export function isEmptySpot(target: EventTarget) {
  if (document.getSelection()?.toString().trim()) return false
  return !(target instanceof Element && target.closest('a[href], img'))
}

/** Für leere Flächen: neu anlegen und suchen */
export function CreateMenuItems({ folderId }: { folderId: string | null }) {
  const app = useApp()
  return (
    <>
      <MenuItem icon={<Plus />} onSelect={() => app.openNewNote({ folderId })} hint="Alt+N">
        Neue Notiz …
      </MenuItem>
      <MenuItem icon={<FolderPlus />} onSelect={() => app.openNewFolder(folderId)}>
        Neuer Ordner …
      </MenuItem>
      <MenuItem icon={<Search />} onSelect={app.openQuickSwitcher} hint="Strg+K">
        Notiz suchen …
      </MenuItem>
    </>
  )
}
