'use client'
import { ArrowDownUp } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Menu, MenuItem } from '@/shared/ui/menu'
import { usePref } from '@/shared/client/prefs'
import { NOTE_ORDERS, parseNoteOrder, type NoteOrder } from '../tree'

const LABELS: Record<NoteOrder, { item: string; spoken: string }> = {
  'name:asc': { item: 'Name (A–Z)', spoken: 'Name, aufsteigend' },
  'name:desc': { item: 'Name (Z–A)', spoken: 'Name, absteigend' },
  'updated:desc': { item: 'Zuletzt bearbeitet (neueste zuerst)', spoken: 'zuletzt bearbeitet, neueste zuerst' },
  'updated:asc': { item: 'Zuletzt bearbeitet (älteste zuerst)', spoken: 'zuletzt bearbeitet, älteste zuerst' },
  'created:desc': { item: 'Erstellt (neueste zuerst)', spoken: 'erstellt, neueste zuerst' },
  'created:asc': { item: 'Erstellt (älteste zuerst)', spoken: 'erstellt, älteste zuerst' },
}

/** Reihenfolge einer Notizliste – je Gerät und Art der Ansicht gemerkt (Ordner bzw. Tag) */
export function useNoteOrder(view: 'folder' | 'tag'): [NoteOrder, (order: NoteOrder) => void] {
  const fallback: NoteOrder = view === 'folder' ? 'name:asc' : 'updated:desc'
  const [stored, setStored] = usePref<string>(`noted:sort:${view}`, fallback)
  return [parseNoteOrder(stored, fallback), setStored]
}

export function SortMenu({ order, onChange }: { order: NoteOrder; onChange: (order: NoteOrder) => void }) {
  const label = `Sortieren: ${LABELS[order].spoken}`
  return (
    <Menu
      trigger={(p) => (
        <Button size="sm" title={label} aria-label={label} {...p}>
          <ArrowDownUp className="size-4" />
          <span className="max-sm:hidden">Sortieren</span>
        </Button>
      )}
    >
      {NOTE_ORDERS.map((o) => (
        <MenuItem key={o} checked={o === order} onSelect={() => onChange(o)}>
          {LABELS[o].item}
        </MenuItem>
      ))}
    </Menu>
  )
}
