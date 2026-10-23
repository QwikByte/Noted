'use client'
import { createContext, useContext } from 'react'
import type { View } from './nav'
import type { Card, CardOption, CardType, Occlusion } from '@/features/flashcards/types'
import type { Folder, NoteFormat, NoteSummary } from '@/features/notes/types'

export type NewNoteOptions = { folderId?: string | null; title?: string; templateId?: string }

/** Karteneditor: bestehende Karte bearbeiten oder neue Karte (optional vorausgefüllt, z. B. aus einer Markierung) */
export type CardEditorInit = {
  card?: Card
  deckId?: string
  type?: CardType
  options?: CardOption[]
  /** Bildverdeckung, z. B. mit einer PDF-Seite als Bild */
  occlusion?: Occlusion
  front?: string
  back?: string
  noteId?: string | null
  /** Vorschlag für den Namen, falls ein neuer Stapel angelegt wird */
  deckName?: string
}

export type CardsFromNoteInit = { id: string; title: string; content: string; preselect?: number[] }

/** Was der Dialog „Verschieben“ verschiebt: eine oder mehrere Notizen oder einen Ordner */
export type MoveTarget = { kind: 'notes'; notes: NoteSummary[] } | { kind: 'folder'; folder: Folder }

export type AppActions = {
  view: View
  go: (view: View, opts?: { replace?: boolean }) => void
  /** Dialog „Neue Notiz“ öffnen */
  openNewNote: (opts?: NewNoteOptions) => void
  /** Notiz direkt anlegen und öffnen – ohne Format im zuletzt gewählten Standardformat */
  createNote: (input: { title: string; folderId: string | null; content?: string; format?: NoteFormat }) => Promise<string>
  openQuickSwitcher: () => void
  /** `onMoved`: nach dem Verschieben, z. B. um die Auswahl aufzuheben */
  openMove: (target: MoveTarget, opts?: { onMoved?: () => void }) => void
  openNewFolder: (parentId: string | null) => void
  openRenameFolder: (folder: Folder) => void
  deleteFolder: (folder: Folder) => void
  /** In den Papierkorb (mit „Rückgängig“) – `true`, wenn es geklappt hat */
  trashNotes: (notes: Pick<NoteSummary, 'id' | 'title'>[]) => Promise<boolean>
  /** Anheften bzw. lösen – `true`, wenn es geklappt hat */
  pinNotes: (notes: Pick<NoteSummary, 'id'>[], pinned: boolean) => Promise<boolean>
  renameNote: (note: NoteSummary) => void
  closeSidebar: () => void
  /** Notiz per Titel (Wikilink-Ziel) auflösen – Tresor-Notizen nur mit `vault` (Links aus dem Tresor) */
  resolveTitle: (target: string, opts?: { vault?: boolean }) => NoteSummary | null
  openCardEditor: (init?: CardEditorInit) => void
  /** Dialog „Karteikarten aus Notiz erstellen“ – `preselect`: Zeilen der Überschriften, deren Abschnitte vorausgewählt sind */
  openCardsFromNote: (note: CardsFromNoteInit) => void
  /** PDF im eingebauten Viewer öffnen (neben der aktuellen Ansicht) – `find`: Wörter, die dort gesucht und hervorgehoben werden */
  openPdf: (file: string, page?: number, opts?: { find?: string[] }) => void
}

export const AppContext = createContext<AppActions | null>(null)

export function useApp(): AppActions {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp außerhalb von NotesApp')
  return ctx
}
