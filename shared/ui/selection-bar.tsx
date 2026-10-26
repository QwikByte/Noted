'use client'
// Mehrfachauswahl in Listen: „Auswählen“, Checkbox, Leiste und Kontextmenü – Leiste und Menü aus derselben
// Aktionsliste, damit sie nicht auseinanderlaufen
import { Fragment } from 'react'
import { Check, ListChecks, X } from 'lucide-react'
import type { ListSelectionState } from '@/shared/client/list-selection'
import { Button } from './button'
import { MenuItem, MenuLabel, MenuSeparator } from './menu'
import { cn } from './cn'

export type SelectionAction = {
  key: string
  label: string
  icon: React.ReactNode
  danger?: boolean
  run: () => void
}

/** Wie die Einträge heißen – für die Anzahl im Menü und den Hinweis auf die Höchstzahl */
export type SelectionNoun = { one: string; many: string }

const tooMany = (max: number, noun: SelectionNoun) => `Höchstens ${max.toLocaleString('de-DE')} ${noun.many} auf einmal.`

/** „Auswählen“ im Kopf einer Liste – Einstieg für Touch und Tastatur, nur wenn die Liste Einträge enthält */
export function SelectButton({ selection }: { selection: ListSelectionState }) {
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

/** Checkbox vor einem Eintrag im Auswahlmodus (neben dem Link, nicht darin) */
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
export function SelectionBar({
  selection,
  actions,
  max,
  noun,
}: {
  selection: ListSelectionState
  actions: SelectionAction[]
  /** Höchstens so viele Einträge auf einmal */
  max: number
  noun: SelectionNoun
}) {
  if (!selection.active) return null
  const count = selection.ids.size
  const over = count > max
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
            disabled={count === 0 || over}
            aria-label={a.label}
            title={over ? tooMany(max, noun) : a.label}
            className={cn('max-sm:w-8 max-sm:px-0', a.danger && 'text-danger hover:text-danger')}
          >
            {a.icon}
            <span className="max-sm:hidden">{a.label}</span>
          </Button>
        ))}
      </div>
      {over ? <p className="w-full px-2 pb-1 text-xs text-warning">{tooMany(max, noun)}</p> : null}
    </div>
  )
}

/** Kontextmenü auf einem Eintrag, der zu einer Auswahl von mindestens zwei gehört */
export function SelectionMenuItems({
  selection,
  actions,
  max,
  noun,
}: {
  selection: ListSelectionState
  actions: SelectionAction[]
  max: number
  noun: SelectionNoun
}) {
  const over = selection.ids.size > max
  return (
    <>
      <MenuLabel>
        {selection.ids.size} {selection.ids.size === 1 ? noun.one : noun.many}
      </MenuLabel>
      {actions.map((a) => (
        <Fragment key={a.key}>
          {a.danger ? <MenuSeparator /> : null}
          <MenuItem icon={a.icon} danger={a.danger} disabled={over} onSelect={a.run}>
            {a.label}
          </MenuItem>
        </Fragment>
      ))}
      {over ? <MenuLabel>{tooMany(max, noun)}</MenuLabel> : null}
      <MenuSeparator />
      <MenuItem icon={<X />} onSelect={selection.stop}>
        Auswahl aufheben
      </MenuItem>
    </>
  )
}
