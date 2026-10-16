'use client'
import { createContext, useContext } from 'react'
import type { View } from './nav'
import type { Card, CardOption, CardType } from '@/features/flashcards/types'
import type { Folder, NoteFormat, NoteSummary } from '@/features/notes/types'

export type NewNoteOptions = { folderId?: string | null; title?: string; templateId?: string }

/** Karteneditor: bestehende Karte bearbeiten oder neue Karte (optional vorausgefüllt, z. B. aus einer Markierung) */
export type CardEditorInit = {
  card?: Card
  deckId?: string
  type?: CardType
  options?: CardOption[]
  front?: string
  back?: string
  noteId?: string | null
  /** Vorschlag für den Namen, falls ein neuer Stapel angelegt wird */
  deckName?: string
}

export type AppActions = {
  view: View
  go: (view: View, opts?: { replace?: boolean }) => void
  /** Dialog „Neue Notiz“ öffnen */
  openNewNote: (opts?: NewNoteOptions) => void
  /** Notiz direkt anlegen und öffnen – ohne Format im zuletzt gewählten Standardformat */
  createNote: (input: { title: string; folderId: string | null; content?: string; format?: NoteFormat }) => Promise<string>
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
  openCardEditor: (init?: CardEditorInit) => void
  /** Dialog „Karteikarten aus Notiz erstellen“ */
  openCardsFromNote: (note: { id: string; title: string; content: string }) => void
  /** PDF im eingebauten Viewer öffnen (neben der aktuellen Ansicht) */
  openPdf: (file: string, page?: number) => void
}

export const AppContext = createContext<AppActions | null>(null)

export function useApp(): AppActions {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp außerhalb von NotesApp')
  return ctx
}
