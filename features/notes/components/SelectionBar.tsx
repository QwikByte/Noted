'use client'
// Aktionen der Mehrfachauswahl in Notizlisten – Leiste und Kontextmenü aus shared/ui/selection-bar
import { FolderInput, Pin, PinOff, Trash2 } from 'lucide-react'
import { useApp } from '@/features/workspace/client/context'
import { SelectionBar, SelectionMenuItems, type SelectionAction } from '@/shared/ui/selection-bar'
import type { ListSelectionState } from '@/shared/client/list-selection'
import { useNotes } from '../client/queries'
import { MAX_BATCH_NOTES } from '../limits'

/** Für Leiste und Menü der Notizlisten (auch im Papierkorb) */
export const NOTES_NOUN = { one: 'Notiz', many: 'Notizen' }

/** Aktionen für ausgewählte Notizen einer Notizliste (Ordner, Tag, Suche, Startseite) */
function useNoteSelectionActions(selection: ListSelectionState): SelectionAction[] {
  const app = useApp()
  const { notes } = useNotes()
  const byId = new Map(notes.map((n) => [n.id, n]))
  const selected = selection.order.filter((id) => selection.ids.has(id)).flatMap((id) => byId.get(id) ?? [])
  // Bei gemischter Auswahl heftet „Anheften“ alle an – „Lösen“ erst, wenn schon alle angeheftet sind
  const allPinned = selected.length > 0 && selected.every((n) => n.pinned)
  return [
    {
      key: 'move',
      label: 'Verschieben …',
      icon: <FolderInput />,
      run: () => app.openMove({ kind: 'notes', notes: selected }, { onMoved: selection.stop }),
    },
    {
      key: 'pin',
      label: allPinned ? 'Lösen' : 'Anheften',
      icon: allPinned ? <PinOff /> : <Pin />,
      // Die Auswahl bleibt: Die Notizen bleiben sichtbar, eine weitere Aktion liegt nahe
      run: () => void app.pinNotes(selected, !allPinned),
    },
    {
      key: 'trash',
      label: 'In den Papierkorb',
      icon: <Trash2 />,
      danger: true,
      run: async () => {
        if (await app.trashNotes(selected)) selection.stop()
      },
    },
  ]
}

export function NoteSelectionBar({ selection }: { selection: ListSelectionState }) {
  return <SelectionBar selection={selection} actions={useNoteSelectionActions(selection)} max={MAX_BATCH_NOTES} noun={NOTES_NOUN} />
}

export function NoteSelectionMenuItems({ selection }: { selection: ListSelectionState }) {
  return (
    <SelectionMenuItems selection={selection} actions={useNoteSelectionActions(selection)} max={MAX_BATCH_NOTES} noun={NOTES_NOUN} />
  )
}
