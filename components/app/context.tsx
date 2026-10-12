'use client'
import { createContext, useContext } from 'react'
import type { View } from '@/lib/client/nav'
import type { Folder, NoteSummary } from '@/lib/shared/types'

export type NewNoteOptions = { folderId?: string | null; title?: string; templateId?: string }

export type AppActions = {
  view: View
  go: (view: View, opts?: { replace?: boolean }) => void
  /** Dialog „Neue Notiz“ öffnen */
  openNewNote: (opts?: NewNoteOptions) => void
  /** Notiz direkt anlegen und öffnen */
  createNote: (input: { title: string; folderId: string | null; content?: string }) => Promise<string>
  openQuickSwitcher: () => void
  openMove: (target: { kind: 'note'; note: NoteSummary } | { kind: 'folder'; folder: Folder }) => void
  openNewFolder: (parentId: string | null) => void
  openRenameFolder: (folder: Folder) => void
  deleteFolder: (folder: Folder) => void
  trashNote: (note: Pick<NoteSummary, 'id' | 'title'>) => void
  togglePin: (note: NoteSummary) => void
  renameNote: (note: NoteSummary) => void
  closeSidebar: () => void
  /** Notiz per Titel (Wikilink-Ziel) auflösen */
  resolveTitle: (target: string) => NoteSummary | null
}

export const AppContext = createContext<AppActions | null>(null)

export function useApp(): AppActions {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp außerhalb von NotesApp')
  return ctx
}
