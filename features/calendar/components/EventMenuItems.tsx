'use client'
// Kontextmenü eines Termins – im Kalender und in der Terminübersicht der Startseite dieselben Einträge
import { FilePlus2, FileText, Pencil, Trash2 } from 'lucide-react'
import { useApp } from '@/features/workspace/client/context'
import { useNotes } from '@/features/notes/client/queries'
import { MenuItem, MenuSeparator } from '@/shared/ui/menu'
import { lectureNote, type DialogTarget } from './EventDialog'
import type { Occurrence } from '../types'

export function EventMenuItems({
  occurrence,
  onDialog,
}: {
  occurrence: Occurrence
  onDialog: (target: DialogTarget) => void
}) {
  const app = useApp()
  const { notes } = useNotes()
  // Mitschrift wie im Termin nur mit Uhrzeit – bei ganztägigen (Feiertag, Exkursion) passt sie selten
  const lecture = occurrence.event.allDay ? null : lectureNote(occurrence, notes, app)
  return (
    <>
      <MenuItem icon={<Pencil />} onSelect={() => onDialog({ kind: 'edit', occurrence })}>
        Termin bearbeiten …
      </MenuItem>
      {lecture ? (
        <MenuItem icon={lecture.note ? <FileText /> : <FilePlus2 />} onSelect={lecture.open}>
          {lecture.note ? 'Mitschrift öffnen' : 'Mitschrift anlegen …'}
        </MenuItem>
      ) : null}
      <MenuSeparator />
      <MenuItem icon={<Trash2 />} danger onSelect={() => onDialog({ kind: 'delete', occurrence })}>
        Löschen …
      </MenuItem>
    </>
  )
}
