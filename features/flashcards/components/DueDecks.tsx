'use client'
import { useMemo } from 'react'
import { GraduationCap } from 'lucide-react'
import { useApp } from '@/features/workspace/client/context'
import { Button } from '@/shared/ui/button'
import { Panel } from '@/shared/ui/panel'
import { useNow } from '@/shared/client/now'
import { useFlashcards } from '../client/flashcards'
import { cardsByDeck, deckCounts } from '../study'

/** Startseite: fällige Karten je Stapel, direkt zum Lernen. Ohne Stapel: nichts. */
export function DueDecks({ className }: { className?: string }) {
  const app = useApp()
  const { data } = useFlashcards()
  const now = useNow()
  const rows = useMemo(() => {
    if (!data) return []
    const byDeck = cardsByDeck(data.cards)
    return data.decks
      .map((deck) => ({ deck, due: deckCounts(deck, byDeck.get(deck.id) ?? [], data.states, now, data.dayStartHour).due }))
      .filter((r) => r.due > 0)
  }, [data, now])

  if (!data || data.decks.length === 0) return null
  const total = rows.reduce((sum, r) => sum + r.due, 0)
  return (
    <Panel
      title="Karteikarten"
      className={className}
      testId="due-decks"
      actions={
        total > 0 ? (
          <Button variant="primary" size="sm" onClick={() => app.go({ kind: 'study', scope: 'all', mode: 'learn' })}>
            <GraduationCap className="size-4" /> Alle lernen
          </Button>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Für heute ist alles gelernt.</p>
      ) : (
        <ul className="-mx-2">
          {rows.map(({ deck, due }) => (
            <li key={deck.id}>
              <button
                type="button"
                onClick={() => app.go({ kind: 'study', scope: `deck:${deck.id}`, mode: 'learn' })}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm hover:bg-hover"
              >
                <span className="min-w-0 flex-1 truncate font-medium">{deck.name}</span>
                <span className="marker shrink-0 px-2 py-0.5 text-xs font-semibold tabular-nums">
                  {due} fällig
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
