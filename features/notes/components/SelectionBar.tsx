'use client'
// Leiste und Kontextmenü für die Mehrfachauswahl – beide aus derselben Aktionsliste, damit sie nicht auseinanderlaufen
import { Fragment } from 'react'
import { Check, FolderInput, ListChecks, Pin, PinOff, Trash2, X } from 'lucide-react'
import { useApp } from '@/features/workspace/client/context'
import { Button } from '@/shared/ui/button'
import { MenuItem, MenuLabel, MenuSeparator } from '@/shared/ui/menu'
import { cn } from '@/shared/ui/cn'
import { useNotes } from '../client/queries'
import type { NoteSelectionState } from '../client/selection'
import { MAX_BATCH_NOTES } from '../limits'

export type SelectionAction = {
  key: string
  label: string
  icon: React.ReactNode
  danger?: boolean
  run: () => void
}

const TOO_MANY = `Höchstens ${MAX_BATCH_NOTES} Notizen auf einmal.`

/** „Auswählen“ im Kopf einer Liste – Einstieg für Touch und Tastatur, nur wenn die Liste Notizen enthält */
export function SelectButton({ selection }: { selection: NoteSelectionState }) {
  if (selection.order.length === 0) return null
  return (
    <Button
      size="sm"
      variant={selection.active ? 'subtle' : 'secondary'}
      aria-pressed={selection.active}
      onClick={selection.active ? selection.stop : selection.start}
    >
      <ListChecks className="size-4" /> Auswählen
    </Button>
  )
}

/** Checkbox vor einer Notiz im Auswahlmodus (neben dem Link, nicht darin) */
export function SelectionCheckbox({
  title,
  checked,
  onToggle,
  className,
}: {
  title: string
  checked: boolean
  onToggle: (e: React.MouseEvent) => void
  className?: string
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={`„${title}“ auswählen`}
      onClick={onToggle}
      className={cn('flex shrink-0 justify-center focus-visible:-outline-offset-2', className)}
    >
      <span
        className={cn(
          'flex size-4.5 items-center justify-center rounded border transition-colors',
          checked ? 'border-accent bg-accent text-on-accent' : 'border-border-strong bg-elevated',
        )}
      >
        {checked ? <Check className="size-3.5" strokeWidth={3} /> : null}
      </span>
    </button>
  )
}

/** Leiste über der Liste: Anzahl, alle auswählen und die Aktionen – haftet beim Scrollen oben */
export function SelectionBar({ selection, actions }: { selection: NoteSelectionState; actions: SelectionAction[] }) {
  if (!selection.active) return null
  const count = selection.ids.size
  const tooMany = count > MAX_BATCH_NOTES
  return (
    <div
      role="toolbar"
      aria-label="Auswahl"
      className="sticky top-0 z-20 mb-3 flex animate-fade-in flex-wrap items-center gap-1 rounded-xl border border-border bg-elevated p-1.5 shadow-pop"
    >
      <Button size="icon-sm" variant="ghost" onClick={selection.stop} aria-label="Auswahl aufheben" title="Auswahl aufheben">
        <X className="size-4" />
      </Button>
      <span aria-live="polite" className="px-1 text-sm font-medium tabular-nums">
        {count} ausgewählt
      </span>
      {count < selection.order.length ? (
        <Button size="sm" variant="ghost" onClick={selection.selectAll}>
          Alle auswählen
        </Button>
      ) : null}
      <div className="ml-auto flex items-center gap-1">
        {actions.map((a) => (
          <Button
            key={a.key}
            size="sm"
            variant="ghost"
            onClick={a.run}
            disabled={count === 0 || tooMany}
            aria-label={a.label}
            title={tooMany ? TOO_MANY : a.label}
            className={cn('max-sm:w-8 max-sm:px-0', a.danger && 'text-danger hover:text-danger')}
          >
            {a.icon}
            <span className="max-sm:hidden">{a.label}</span>
          </Button>
        ))}
      </div>
      {tooMany ? <p className="w-full px-2 pb-1 text-xs text-warning">{TOO_MANY}</p> : null}
    </div>
  )
}

/** Kontextmenü auf einer Notiz, die zu einer Auswahl von mindestens zwei gehört */
export function SelectionMenuItems({ selection, actions }: { selection: NoteSelectionState; actions: SelectionAction[] }) {
  const tooMany = selection.ids.size > MAX_BATCH_NOTES
  return (
    <>
      <MenuLabel>{selection.ids.size} Notizen</MenuLabel>
      {actions.map((a) => (
        <Fragment key={a.key}>
          {a.danger ? <MenuSeparator /> : null}
          <MenuItem icon={a.icon} danger={a.danger} disabled={tooMany} onSelect={a.run}>
            {a.label}
          </MenuItem>
        </Fragment>
      ))}
      {tooMany ? <MenuLabel>{TOO_MANY}</MenuLabel> : null}
      <MenuSeparator />
      <MenuItem icon={<X />} onSelect={selection.stop}>
        Auswahl aufheben
      </MenuItem>
    </>
  )
}

/** Aktionen für ausgewählte Notizen einer Notizliste (Ordner, Tag, Suche, Startseite) */
function useNoteSelectionActions(selection: NoteSelectionState): SelectionAction[] {
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

export function NoteSelectionBar({ selection }: { selection: NoteSelectionState }) {
  return <SelectionBar selection={selection} actions={useNoteSelectionActions(selection)} />
}

export function NoteSelectionMenuItems({ selection }: { selection: NoteSelectionState }) {
  return <SelectionMenuItems selection={selection} actions={useNoteSelectionActions(selection)} />
}
