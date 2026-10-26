'use client'
// Menü am Knopf „Üben“: alle Karten oder eine eigene Übung – heute vergessen, Problemkarten, die schwersten
import { useMemo } from 'react'
import { AlertTriangle, Dumbbell, Flame, RotateCcw } from 'lucide-react'
import { useApp } from '@/features/workspace/client/context'
import type { StudyScope } from '@/features/workspace/client/nav'
import { Menu, MenuItem, MenuSeparator } from '@/shared/ui/menu'
import { useAgainToday, useFlashcards } from '../client/flashcards'
import { HARDEST_COUNT, STUDY_FILTERS, allItems, filterItems, leechThreshold, type StateMap, type StudyFilter } from '../study'
import type { Card } from '../types'

/** Titel der eigenen Übungen – im Menü und über der Sitzung */
export const FILTER_LABELS: Record<StudyFilter, string> = {
  'again-today': 'Heute vergessen',
  problem: 'Problemkarten',
  hardest: `Schwerste ${HARDEST_COUNT}`,
}

const ICONS: Record<StudyFilter, React.ReactNode> = {
  'again-today': <RotateCcw />,
  problem: <AlertTriangle />,
  hardest: <Flame />,
}

export function PracticeMenu({
  scope,
  cards,
  states,
  trigger,
}: {
  scope: StudyScope
  cards: Card[]
  states: StateMap
  trigger: React.ComponentProps<typeof Menu>['trigger']
}) {
  const app = useApp()
  const again = useAgainToday()
  const decks = useFlashcards().data?.decks
  const counts = useMemo(
    () => ({
      all: allItems(cards).length,
      'again-today': filterItems('again-today', cards, states, { again: again.keys }).length,
      problem: filterItems('problem', cards, states, { leech: leechThreshold(decks ?? []) }).length,
      hardest: filterItems('hardest', cards, states).length,
    }),
    [cards, states, again.keys, decks],
  )
  return (
    <Menu trigger={trigger}>
      <MenuItem icon={<Dumbbell />} onSelect={() => app.go({ kind: 'study', scope, mode: 'practice' })} disabled={counts.all === 0}>
        Alle Karten
      </MenuItem>
      <MenuSeparator />
      {STUDY_FILTERS.map((filter) => (
        <MenuItem
          key={filter}
          icon={ICONS[filter]}
          onSelect={() => app.go({ kind: 'study', scope, mode: 'practice', filter })}
          disabled={counts[filter] === 0}
          // Ohne Verbindung kennt nur dieses Gerät die heutigen Bewertungen
          hint={filter === 'again-today' && again.offline ? 'offline: nur dieses Gerät' : undefined}
        >
          {FILTER_LABELS[filter]}
          {filter === 'hardest' ? '' : ` (${counts[filter]})`}
        </MenuItem>
      ))}
    </Menu>
  )
}
