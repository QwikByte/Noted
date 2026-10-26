'use client'
// Auswahl einer Notizliste für ihre Karten – Zustand und Tastatur liefert useListSelection (shared/client)
import { createContext, useContext } from 'react'
import type { ListSelectionState } from '@/shared/client/list-selection'

export const NoteSelectionContext = createContext<ListSelectionState | null>(null)

export function useNoteSelectionContext() {
  return useContext(NoteSelectionContext)
}
