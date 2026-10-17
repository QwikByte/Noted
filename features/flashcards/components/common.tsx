'use client'
import { cn } from '@/shared/ui/cn'
import { cardStatus, type CardStatus } from '../srs'
import { reviewKey, sidesOf, type StateMap } from '../study'
import type { Card } from '../types'

const STATUS_LABELS: Record<CardStatus, string> = {
  new: 'Neu',
  learning: 'Lernend',
  young: 'Gelernt',
  mature: 'Sicher',
}

const STATUS_COLORS: Record<CardStatus, string> = {
  new: 'bg-border-strong',
  learning: 'bg-warning',
  young: 'bg-accent',
  mature: 'bg-success',
}

export function statusCounts(cards: Card[], states: StateMap): Record<CardStatus, number> {
  const counts: Record<CardStatus, number> = { new: 0, learning: 0, young: 0, mature: 0 }
  for (const card of cards) for (const side of sidesOf(card)) counts[cardStatus(states.get(reviewKey(card.id, side)))]++
  return counts
}

/** Fortschrittsbalken: Anteil neuer, lernender, gelernter und sicherer Karten. */
export function ProgressBar({ counts, className }: { counts: Record<CardStatus, number>; className?: string }) {
  const total = counts.new + counts.learning + counts.young + counts.mature
  return (
    <div
      className={cn('flex h-1.5 overflow-hidden rounded-full bg-subtle', className)}
      role="img"
      aria-label={`${counts.mature} sicher, ${counts.young} gelernt, ${counts.learning} lernend, ${counts.new} neu`}
    >
      {total > 0
        ? (['mature', 'young', 'learning', 'new'] as CardStatus[]).map((s) =>
            counts[s] > 0 ? <div key={s} className={STATUS_COLORS[s]} style={{ width: `${(counts[s] / total) * 100}%` }} /> : null,
          )
        : null}
    </div>
  )
}

export function Legend({ counts }: { counts: Record<CardStatus, number> }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {(['new', 'learning', 'young', 'mature'] as CardStatus[]).map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <span className={cn('size-2 rounded-full', STATUS_COLORS[s])} />
          {STATUS_LABELS[s]} <span className="font-medium text-fg tabular-nums">{counts[s]}</span>
        </span>
      ))}
    </div>
  )
}
