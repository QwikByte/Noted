'use client'
// Eine Karte in einer Kartenliste (Stapel und „Alle Karten“): Vorder- und Rückseite, Fälligkeit, Hinweise und Aktionen
import { AlertTriangle, FileText, Layers, MoreVertical, Pause, Pencil, Play, RotateCcw, Trash2 } from 'lucide-react'
import { useApp } from '@/features/workspace/client/context'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Menu, MenuItem, MenuSeparator, useContextMenu } from '@/shared/ui/menu'
import { SelectionCheckbox } from '@/shared/ui/selection-bar'
import type { ListSelectionState } from '@/shared/client/list-selection'
import { cn } from '@/shared/ui/cn'
import { CardMarkdown } from './CardMarkdown'
import { OcclusionThumb } from './Occlusion'
import { CARD_TYPE_LABELS } from '../client/flashcards'
import { examDue } from '../exam'
import { maskName } from '../occlusion'
import { endOfDay, formatInterval } from '../srs'
import { cardLapses, reviewKey, sidesOf, type StateMap } from '../study'
import type { Card, DeckExam } from '../types'

/** Was eine Karte selbst kann – die Liste kümmert sich um Meldungen und die Rückfrage beim Löschen */
export type CardRowActions = {
  toggleSuspended: (card: Card) => void
  relearn: (card: Card) => void
  remove: (card: Card) => void
}

/** Nächste Abfrage der Karte – vor einer Klausur wie im Lernmodus vorgezogen */
function dueLabel(
  card: Card,
  states: StateMap,
  now: number,
  exam: DeckExam | null,
  dayStartHour: number,
): { text: string; tone: 'neutral' | 'marker' } {
  let earliest = Infinity
  for (const side of sidesOf(card)) {
    const s = states.get(reviewKey(card.id, side))
    if (!s) return { text: 'Neu', tone: 'neutral' }
    earliest = Math.min(earliest, exam ? examDue(s, reviewKey(card.id, side), exam, now, dayStartHour) : s.due)
  }
  if (earliest <= endOfDay(now, dayStartHour)) return { text: 'Heute fällig', tone: 'marker' }
  return { text: `in ${formatInterval(earliest - now)}`, tone: 'neutral' }
}

export function CardRow({
  card,
  states,
  now,
  exam,
  dayStartHour,
  noteTitle,
  deckName,
  problem,
  actions,
  selection,
  listOrder,
  selectionMenu,
}: {
  card: Card
  states: StateMap
  now: number
  exam: DeckExam | null
  /** Beginn des Lerntags (Konto) */
  dayStartHour: number
  noteTitle?: string
  /** Im Browser über alle Stapel: der Stapel der Karte */
  deckName?: string
  problem: boolean
  actions: CardRowActions
  selection: ListSelectionState
  /** Reihenfolge der Liste (Umschalt-Klick wählt einen Bereich darin) */
  listOrder: readonly string[]
  /** Kontextmenü, wenn die Karte zu einer Auswahl von mindestens zwei gehört */
  selectionMenu: React.ReactNode
}) {
  const app = useApp()
  const openContextMenu = useContextMenu()
  const due = dueLabel(card, states, now, exam, dayStartHour)
  const learned = sidesOf(card).some((side) => states.has(reviewKey(card.id, side)))
  const selecting = selection.active
  const selected = selection.ids.has(card.id)

  // Dieselben Einträge im Menü „⋮“ und beim Rechtsklick – Aussetzen und Neu lernen für jede Karte
  const cardItems = (
    <>
      <MenuItem icon={<Pencil />} onSelect={() => app.openCardEditor({ card })}>
        Karte bearbeiten …
      </MenuItem>
      {noteTitle ? (
        <MenuItem icon={<FileText />} onSelect={() => app.go({ kind: 'note', id: card.noteId! })}>
          Zur Notiz
        </MenuItem>
      ) : null}
      {deckName ? (
        <MenuItem icon={<Layers />} onSelect={() => app.go({ kind: 'deck', id: card.deckId })}>
          Zum Stapel
        </MenuItem>
      ) : null}
      <MenuItem icon={card.suspended ? <Play /> : <Pause />} onSelect={() => actions.toggleSuspended(card)}>
        {card.suspended ? 'Fortsetzen' : 'Aussetzen'}
      </MenuItem>
      {learned ? (
        <MenuItem icon={<RotateCcw />} onSelect={() => actions.relearn(card)}>
          Neu lernen
        </MenuItem>
      ) : null}
      <MenuSeparator />
      <MenuItem icon={<Trash2 />} danger onSelect={() => actions.remove(card)}>
        Karte löschen …
      </MenuItem>
    </>
  )

  return (
    <li
      className={cn(
        'group rounded-xl border p-3 sm:p-4',
        selected ? 'border-accent bg-accent-soft' : 'border-border bg-elevated',
        selecting && 'cursor-pointer',
      )}
      // Umschalt-Klick wählt einen Bereich von Karten, keinen Text
      onMouseDown={(e) => {
        if (e.shiftKey) e.preventDefault()
      }}
      onContextMenu={(e) =>
        openContextMenu(e, selected && selection.ids.size >= 2 ? selectionMenu : cardItems, { text: true, copy: true })
      }
      onClick={(e) => {
        // Strg/⌘- und Umschalt-Klick wählen aus, im Auswahlmodus auch ein einfacher Klick – nicht auf Knöpfen und Links
        if (!(selecting || e.ctrlKey || e.metaKey || e.shiftKey)) return
        if ((e.target as HTMLElement).closest('button, a, input')) return
        e.preventDefault()
        selection.click(card.id, listOrder, e)
      }}
      data-testid="card-row"
    >
      <div className="flex items-start gap-3">
        {selecting ? (
          <SelectionCheckbox
            title={card.front.slice(0, 60)}
            checked={selected}
            onToggle={(e) => selection.click(card.id, listOrder, e)}
            className="pt-0.5"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <CardMarkdown text={card.front} className="line-clamp-4 font-medium" />
          {card.type === 'occlusion' && card.occlusion ? <OcclusionThumb occlusion={card.occlusion} /> : null}
          <CardMarkdown
            text={
              card.type === 'mc'
                ? card.options.map((o) => (o.correct ? `✓ ${o.text}` : o.text)).join(' · ')
                : card.type === 'occlusion' && card.occlusion
                  ? card.occlusion.masks.map((_, i) => maskName(card.occlusion!, i)).join(' · ')
                  : card.back
            }
            className="mt-1 line-clamp-2 text-sm text-muted"
          />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {deckName ? (
              <button
                type="button"
                onClick={() => app.go({ kind: 'deck', id: card.deckId })}
                className="inline-flex max-w-48 items-center gap-1 truncate text-xs font-medium text-muted hover:text-fg"
              >
                <Layers className="size-3 shrink-0" />
                <span className="truncate">{deckName}</span>
              </button>
            ) : null}
            <Badge>{CARD_TYPE_LABELS[card.type]}</Badge>
            {card.suspended ? <Badge>Ausgesetzt</Badge> : <Badge tone={due.tone}>{due.text}</Badge>}
            {problem ? (
              <Badge tone="warning">
                <AlertTriangle className="size-3" /> Problemkarte · {cardLapses(card, states)}× vergessen
              </Badge>
            ) : null}
            {noteTitle ? (
              <button
                type="button"
                onClick={() => app.go({ kind: 'note', id: card.noteId! })}
                className="inline-flex max-w-56 items-center gap-1 truncate text-xs text-muted hover:text-fg"
              >
                <FileText className="size-3 shrink-0" />
                <span className="truncate">{noteTitle}</span>
              </button>
            ) : null}
          </div>
          {problem || card.suspended ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button size="sm" variant="subtle" onClick={() => actions.toggleSuspended(card)}>
                {card.suspended ? <Play className="size-4" /> : <Pause className="size-4" />}
                {card.suspended ? 'Fortsetzen' : 'Aussetzen'}
              </Button>
              {learned ? (
                <Button
                  size="sm"
                  variant="subtle"
                  onClick={() => actions.relearn(card)}
                  title="Lernstand dieser Karte zurücksetzen, z. B. nach dem Überarbeiten"
                >
                  <RotateCcw className="size-4" /> Neu lernen
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-0.5">
          <Button variant="ghost" size="icon-sm" onClick={() => app.openCardEditor({ card })} aria-label="Karte bearbeiten" title="Bearbeiten">
            <Pencil className="size-4" />
          </Button>
          {/* Auch ohne Rechtsklick erreichbar, z. B. auf dem Handy */}
          <Menu
            trigger={(p) => (
              <Button variant="ghost" size="icon-sm" aria-label="Weitere Aktionen" title="Weitere Aktionen" {...p}>
                <MoreVertical className="size-4" />
              </Button>
            )}
          >
            {cardItems}
          </Menu>
        </div>
      </div>
    </li>
  )
}
