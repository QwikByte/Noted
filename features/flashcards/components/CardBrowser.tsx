'use client'
// „Alle Karten“: Karten aller Stapel durchsuchen, filtern und sortieren – mit Mehrfachauswahl zum Verschieben,
// Aussetzen, Fortsetzen, Neu lernen und Löschen
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ChevronRight, CloudOff, Layers, Loader2, Search } from 'lucide-react'
import { useApp } from '@/features/workspace/client/context'
import { useNotes } from '@/features/notes/client/queries'
import { Page, PageHeader } from '@/shared/ui/page-layout'
import { Button } from '@/shared/ui/button'
import { Select } from '@/shared/ui/input'
import { SelectButton } from '@/shared/ui/selection-bar'
import { cn } from '@/shared/ui/cn'
import { useNow } from '@/shared/client/now'
import { useListSelection } from '@/shared/client/list-selection'
import { NetworkError } from '@/shared/client/api'
import { CARD_TYPE_LABELS, useFlashcards } from '../client/flashcards'
import { BROWSE_SORTS, NO_FILTER, browseCards, type BrowseFilter, type BrowseSort } from '../browse'
import { nextExam } from '../exam'
import { isProblemCard } from '../study'
import { STATUS_LABELS } from './common'
import { CardRow } from './CardRow'
import { useCardActions } from './CardActions'
import type { CardStatus } from '../srs'
import type { CardType } from '../types'

const PAGE = 100

const TOGGLES: { key: 'due' | 'problem' | 'suspended' | 'fromNote'; label: string }[] = [
  { key: 'due', label: 'Heute fällig' },
  { key: 'problem', label: 'Problemkarten' },
  { key: 'suspended', label: 'Ausgesetzt' },
  { key: 'fromNote', label: 'Aus Notiz' },
]

const selectClass = 'h-9! w-auto! min-w-0 text-sm!'

export function CardBrowser({ initialQuery }: { initialQuery: string }) {
  const app = useApp()
  const { data, isLoading, error } = useFlashcards()
  const { notes } = useNotes()
  const now = useNow()
  const [filter, setFilter] = useState<BrowseFilter>({ ...NO_FILTER, query: initialQuery })
  const [sort, setSort] = useState<BrowseSort>('position')
  const [limit, setLimit] = useState(PAGE)

  // Suchbegriff in die Adresse (ersetzen, ohne neuen Eintrag im Verlauf)
  useEffect(() => {
    const t = setTimeout(() => app.go({ kind: 'browse', q: filter.query.trim() || undefined }, { replace: true }), 300)
    return () => clearTimeout(t)
  }, [filter.query, app])

  const update = (patch: Partial<BrowseFilter>) => {
    setFilter((f) => ({ ...f, ...patch }))
    setLimit(PAGE)
  }

  const decks = useMemo(() => data?.decks ?? [], [data])
  const deckNames = useMemo(() => new Map(decks.map((d) => [d.id, d.name])), [decks])
  const noteTitles = useMemo(() => new Map(notes.map((n) => [n.id, n.title])), [notes])
  const cards = useMemo(
    () => (data ? browseCards(data.cards, data.decks, data.states, filter, sort, now) : []),
    [data, filter, sort, now],
  )
  const order = useMemo(() => cards.map((c) => c.id), [cards])
  const root = useRef<HTMLDivElement>(null)
  const selection = useListSelection({ order, resetKey: JSON.stringify([filter, sort]), root })
  const cardList = useCardActions(selection)
  const total = data?.cards.length ?? 0
  const filtered = cards.length !== total

  return (
    <Page>
      <PageHeader
        breadcrumb={
          <button type="button" onClick={() => app.go({ kind: 'cards' })} className="mb-2 flex items-center gap-1 text-sm text-muted hover:text-fg">
            <Layers className="size-3.5" /> Karteikarten <ChevronRight className="size-3.5" />
          </button>
        }
        title="Alle Karten"
        subtitle={data ? (filtered ? `${cards.length} von ${total} Karten` : `${total} ${total === 1 ? 'Karte' : 'Karten'}`) : undefined}
        actions={<SelectButton selection={selection} />}
      />

      {isLoading ? (
        <Loader2 className="mx-auto size-6 animate-spin text-faint" />
      ) : !data ? (
        <div className="flex items-center gap-2 rounded-lg border border-border p-4 text-sm text-muted">
          <CloudOff className="size-4" />
          {error instanceof NetworkError ? 'Offline – die Karteikarten wurden auf diesem Gerät noch nicht geladen.' : 'Die Karteikarten konnten nicht geladen werden.'}
        </div>
      ) : (
        <div ref={root}>
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
            <input
              type="search"
              value={filter.query}
              onChange={(e) => update({ query: e.target.value })}
              placeholder="In allen Stapeln suchen …"
              aria-label="Karten durchsuchen"
              autoFocus
              className="h-9 w-full rounded-md border border-border bg-elevated pr-3 pl-9 text-sm outline-none placeholder:text-faint focus:border-accent focus:ring-3 focus:ring-accent/20"
            />
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Select
              aria-label="Stapel"
              value={filter.deckId ?? ''}
              onChange={(e) => update({ deckId: e.target.value || null })}
              className={selectClass}
            >
              <option value="">Alle Stapel</option>
              {decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Kartenart"
              value={filter.type ?? ''}
              onChange={(e) => update({ type: (e.target.value || null) as CardType | null })}
              className={selectClass}
            >
              <option value="">Alle Arten</option>
              {(Object.keys(CARD_TYPE_LABELS) as CardType[]).map((t) => (
                <option key={t} value={t}>
                  {CARD_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Lernstand"
              value={filter.status ?? ''}
              onChange={(e) => update({ status: (e.target.value || null) as CardStatus | null })}
              className={selectClass}
            >
              <option value="">Jeder Lernstand</option>
              {(Object.keys(STATUS_LABELS) as CardStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
            <Select aria-label="Sortieren" value={sort} onChange={(e) => setSort(e.target.value as BrowseSort)} className={selectClass}>
              {BROWSE_SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5" aria-label="Weitere Filter">
            {TOGGLES.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                aria-pressed={filter[key]}
                onClick={() => update({ [key]: !filter[key] })}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors',
                  filter[key] ? 'border-accent bg-accent-soft font-medium text-accent-text' : 'border-border text-muted hover:bg-hover hover:text-fg',
                )}
              >
                {key === 'problem' ? <AlertTriangle className="size-3.5 text-warning" /> : null}
                {label}
              </button>
            ))}
          </div>

          {cardList.bar}
          <ul className="space-y-2" data-testid="card-list">
            {cards.slice(0, limit).map((card) => {
              const deck = decks.find((d) => d.id === card.deckId)
              return (
                <CardRow
                  key={card.id}
                  card={card}
                  states={data.states}
                  now={now}
                  exam={nextExam(deck?.exams, now)}
                  noteTitle={card.noteId ? noteTitles.get(card.noteId) : undefined}
                  deckName={deckNames.get(card.deckId)}
                  problem={isProblemCard(card, data.states)}
                  actions={cardList.rowActions}
                  selection={selection}
                  listOrder={order}
                  selectionMenu={cardList.menu}
                />
              )
            })}
            {cards.length === 0 ? (
              <li className="py-6 text-center text-sm text-muted">{total === 0 ? 'Noch keine Karten.' : 'Keine Karte passt zur Suche.'}</li>
            ) : null}
            {cards.length > limit ? (
              <li className="text-center">
                <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
                  Weitere {Math.min(PAGE, cards.length - limit)} anzeigen
                </Button>
              </li>
            ) : null}
          </ul>
        </div>
      )}
      {cardList.dialogs}
    </Page>
  )
}
