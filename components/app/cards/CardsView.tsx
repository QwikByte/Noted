'use client'
import { useMemo, useState } from 'react'
import { CloudOff, Dumbbell, GraduationCap, Layers, Loader2, Plus } from 'lucide-react'
import { useApp } from '../context'
import { Page, PageHeader } from '../views'
import { Button } from '../../ui/button'
import { ProgressBar, statusCounts, useNow } from './common'
import { DeckSettingsDialog } from './DeckDialogs'
import { useFlashcards } from '@/lib/client/flashcards'
import { NetworkError } from '@/lib/client/api'
import { deckCounts, type DeckCounts } from '@/lib/shared/study'
import type { Card } from '@/lib/shared/types'

/** Fällige Karten aller Stapel (für die Seitenleiste) */
export function useDueTotal(): number {
  const { data } = useFlashcards()
  const now = useNow()
  return useMemo(() => {
    if (!data) return 0
    return data.decks.reduce(
      (sum, d) =>
        sum +
        deckCounts(
          d,
          data.cards.filter((c) => c.deckId === d.id),
          data.states,
          now,
        ).due,
      0,
    )
  }, [data, now])
}

export function CardsView() {
  const app = useApp()
  const { data, isLoading, error } = useFlashcards()
  const now = useNow()
  const [creating, setCreating] = useState(false)

  const rows = useMemo(() => {
    if (!data) return []
    const byDeck = new Map<string, Card[]>()
    for (const c of data.cards) byDeck.set(c.deckId, [...(byDeck.get(c.deckId) ?? []), c])
    return data.decks.map((deck) => {
      const cards = byDeck.get(deck.id) ?? []
      return { deck, cards, counts: deckCounts(deck, cards, data.states, now), status: statusCounts(cards, data.states) }
    })
  }, [data, now])

  const due = rows.reduce((s, r) => s + r.counts.due, 0)
  const total = data?.cards.length ?? 0

  return (
    <Page>
      <PageHeader
        icon={<Layers />}
        title="Karteikarten"
        subtitle={
          data
            ? `${rows.length} Stapel · ${total} ${total === 1 ? 'Karte' : 'Karten'} · heute ${due} fällig`
            : undefined
        }
        actions={
          <>
            {due > 0 ? (
              <Button variant="primary" size="sm" onClick={() => app.go({ kind: 'study', scope: 'all', mode: 'learn' })}>
                <GraduationCap className="size-4" /> Alle lernen
              </Button>
            ) : null}
            <Button size="sm" onClick={() => setCreating(true)} variant={due > 0 ? 'secondary' : 'primary'}>
              <Plus className="size-4" /> <span className="max-sm:hidden">Neuer</span> Stapel
            </Button>
          </>
        }
      />

      {isLoading ? (
        <Loader2 className="mx-auto size-6 animate-spin text-faint" />
      ) : !data ? (
        <div className="flex items-center gap-2 rounded-xl border border-border p-4 text-sm text-muted">
          <CloudOff className="size-4" />
          {error instanceof NetworkError ? 'Offline – die Karteikarten wurden auf diesem Gerät noch nicht geladen.' : 'Die Karteikarten konnten nicht geladen werden.'}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-12 text-center">
          <Layers className="mb-3 size-10 text-faint" />
          <p className="font-medium">Noch keine Karteikarten</p>
          <p className="mt-1 max-w-md text-sm text-muted">
            Lege einen Stapel an, z. B. pro Fach. Karten kannst du direkt schreiben – als Frage/Antwort, beidseitig oder Multiple
            Choice – oder aus einer Notiz erstellen (Menü ⋮ in der Notiz → „Karteikarten aus Notiz“).
          </p>
          <Button variant="primary" className="mt-4" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> Ersten Stapel anlegen
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2" data-testid="deck-list">
          {rows.map(({ deck, cards, counts, status }) => (
            <DeckTile
              key={deck.id}
              name={deck.name}
              description={deck.description}
              cards={cards.length}
              counts={counts}
              status={status}
              onOpen={() => app.go({ kind: 'deck', id: deck.id })}
              onLearn={() => app.go({ kind: 'study', scope: `deck:${deck.id}`, mode: 'learn' })}
              onPractice={() => app.go({ kind: 'study', scope: `deck:${deck.id}`, mode: 'practice' })}
            />
          ))}
        </div>
      )}

      {creating ? (
        <DeckSettingsDialog onClose={() => setCreating(false)} onSaved={(deck) => app.go({ kind: 'deck', id: deck.id })} />
      ) : null}
    </Page>
  )
}

function DeckTile({
  name,
  description,
  cards,
  counts,
  status,
  onOpen,
  onLearn,
  onPractice,
}: {
  name: string
  description: string
  cards: number
  counts: DeckCounts
  status: ReturnType<typeof statusCounts>
  onOpen: () => void
  onLearn: () => void
  onPractice: () => void
}) {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-elevated transition hover:border-border-strong hover:shadow-card">
      <button type="button" onClick={onOpen} className="flex flex-1 flex-col gap-1 p-4 pb-3 text-left">
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1 truncate font-semibold">{name}</span>
          {counts.due > 0 ? (
            <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-white tabular-nums">{counts.due} fällig</span>
          ) : cards > 0 ? (
            <span className="shrink-0 rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">Erledigt</span>
          ) : null}
        </div>
        {description ? <p className="line-clamp-1 text-sm text-muted">{description}</p> : null}
        <p className="text-xs text-faint">
          {cards} {cards === 1 ? 'Karte' : 'Karten'}
          {counts.newTotal > 0 ? ` · ${counts.newTotal} neu` : ''}
          {counts.reviewedToday > 0 ? ` · heute ${counts.reviewedToday} gelernt` : ''}
        </p>
        <ProgressBar counts={status} className="mt-2" />
      </button>
      <div className="flex gap-1 border-t border-border p-1.5">
        <Button variant="ghost" size="sm" className="flex-1" onClick={onLearn} disabled={cards === 0}>
          <GraduationCap className="size-4" /> Lernen
        </Button>
        <Button variant="ghost" size="sm" className="flex-1" onClick={onPractice} disabled={cards === 0}>
          <Dumbbell className="size-4" /> Üben
        </Button>
      </div>
    </div>
  )
}
