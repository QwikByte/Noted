'use client'
import { useMemo, useState } from 'react'
import { ChartColumn, CloudOff, Dumbbell, FileArchive, GraduationCap, Layers, Loader2, MoreVertical, Plus, Upload } from 'lucide-react'
import { Menu, MenuItem } from '@/shared/ui/menu'
import { useApp } from '@/features/workspace/client/context'
import { Page, PageHeader } from '@/shared/ui/page-layout'
import { Button } from '@/shared/ui/button'
import { ProgressBar, statusCounts } from './common'
import { useNow } from '@/shared/client/now'
import { AnkiImportDialog, DeckPackageImportDialog, DeckSettingsDialog } from './DeckDialogs'
import { useFlashcards } from '../client/flashcards'
import { NetworkError } from '@/shared/client/api'
import { deckCounts, type DeckCounts } from '../study'
import type { Card } from '../types'

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
  const [importing, setImporting] = useState(false)
  const [importingPackage, setImportingPackage] = useState(false)

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
            <Button size="sm" onClick={() => app.go({ kind: 'stats' })} aria-label="Lernstatistik" title="Lernstatistik">
              <ChartColumn className="size-4" /> <span className="max-sm:hidden">Statistik</span>
            </Button>
            <Button size="sm" onClick={() => setCreating(true)} variant={due > 0 ? 'secondary' : 'primary'}>
              <Plus className="size-4" /> <span className="max-sm:hidden">Neuer</span> Stapel
            </Button>
            <Menu
              trigger={(p) => (
                <Button variant="ghost" size="icon-sm" aria-label="Weitere Aktionen" {...p}>
                  <MoreVertical className="size-4" />
                </Button>
              )}
            >
              <MenuItem icon={<FileArchive />} onSelect={() => setImportingPackage(true)}>
                Stapel importieren …
              </MenuItem>
              <MenuItem icon={<Upload />} onSelect={() => setImporting(true)}>
                Anki-Deck importieren …
              </MenuItem>
            </Menu>
          </>
        }
      />

      {isLoading ? (
        <Loader2 className="mx-auto size-6 animate-spin text-faint" />
      ) : !data ? (
        <div className="flex items-center gap-2 rounded-lg border border-border p-4 text-sm text-muted">
          <CloudOff className="size-4" />
          {error instanceof NetworkError ? 'Offline – die Karteikarten wurden auf diesem Gerät noch nicht geladen.' : 'Die Karteikarten konnten nicht geladen werden.'}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-border-strong px-6 py-12 text-center">
          <Layers className="mb-3 size-9 stroke-[1.5] text-faint" />
          <p className="font-semibold">Noch keine Karteikarten</p>
          <p className="mt-1 max-w-md text-sm text-muted">
            Karten kannst du auch aus einer Notiz erstellen (Menü ⋮ in der Notiz → „Karteikarten aus Notiz“).
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" /> Ersten Stapel anlegen
            </Button>
            <Button onClick={() => setImporting(true)}>
              <Upload className="size-4" /> Aus Anki importieren
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2" data-testid="deck-list">
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
      {importing ? <AnkiImportDialog onClose={() => setImporting(false)} /> : null}
      {importingPackage ? (
        <DeckPackageImportDialog
          decks={data?.decks ?? []}
          onClose={() => setImportingPackage(false)}
          onOpenDeck={(id) => app.go({ kind: 'deck', id })}
        />
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
    <div className="deck-stack flex flex-col rounded-lg border border-border bg-elevated transition-colors hover:border-border-strong">
      <button type="button" onClick={onOpen} className="flex flex-1 flex-col gap-1 p-4 pb-3 text-left">
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1 truncate font-semibold">{name}</span>
          {counts.due > 0 ? (
            <span className="marker shrink-0 px-2 py-0.5 text-xs font-semibold tabular-nums">{counts.due} fällig</span>
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
