'use client'
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  ChevronRight,
  Copy,
  Dumbbell,
  FileText,
  GraduationCap,
  Layers,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Trash2,
  Upload,
} from 'lucide-react'
import { useApp } from '../context'
import { Page, PageHeader } from '../views'
import { CardMarkdown } from './CardMarkdown'
import { Legend, ProgressBar, statusCounts, useNow } from './common'
import { DeckSettingsDialog, ImportCardsDialog } from './DeckDialogs'
import { Button } from '../../ui/button'
import { Badge } from '../../ui/badge'
import { Menu, MenuItem, MenuSeparator } from '../../ui/menu'
import { ConfirmModal } from '../../ui/modal'
import { useToast } from '../../ui/toast'
import { CARD_TYPE_LABELS, deleteCard, deleteDeck, resetDeckProgress, useFlashcards } from '@/lib/client/flashcards'
import { useNotes } from '@/lib/client/queries'
import { copyText } from '@/lib/client/clipboard'
import { errorMessage } from '@/lib/client/api'
import { deckToMarkdown } from '@/lib/shared/card-markdown'
import { endOfDay, formatInterval } from '@/lib/shared/srs'
import { byPosition, deckCounts, reviewKey, sidesOf, type StateMap } from '@/lib/shared/study'
import type { Card } from '@/lib/shared/types'

const PAGE = 100

function dueLabel(card: Card, states: StateMap, now: number): { text: string; tone: 'accent' | 'neutral' | 'warning' } {
  let earliest = Infinity
  for (const side of sidesOf(card)) {
    const s = states.get(reviewKey(card.id, side))
    if (!s) return { text: 'Neu', tone: 'accent' }
    earliest = Math.min(earliest, s.due)
  }
  if (earliest <= endOfDay(now)) return { text: 'Heute fällig', tone: 'warning' }
  return { text: `in ${formatInterval(earliest - now)}`, tone: 'neutral' }
}

export function DeckView({ id }: { id: string }) {
  const app = useApp()
  const qc = useQueryClient()
  const toast = useToast()
  const { data, isLoading } = useFlashcards()
  const { notes } = useNotes()
  const now = useNow()
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [dialog, setDialog] = useState<'settings' | 'import' | 'reset' | 'delete' | null>(null)
  const [toDelete, setToDelete] = useState<Card | null>(null)
  const [busy, setBusy] = useState(false)

  const deck = data?.decks.find((d) => d.id === id)
  const cards = useMemo(() => (data ? data.cards.filter((c) => c.deckId === id).sort(byPosition) : []), [data, id])
  const counts = data && deck ? deckCounts(deck, cards, data.states, now) : null
  const status = useMemo(() => statusCounts(cards, data?.states ?? new Map()), [cards, data])
  const noteTitles = useMemo(() => new Map(notes.map((n) => [n.id, n.title])), [notes])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return cards
    return cards.filter((c) => [c.front, c.back, ...c.options.map((o) => o.text)].some((t) => t.toLowerCase().includes(q)))
  }, [cards, query])

  if (!deck || !data || !counts) {
    return (
      <Page>
        {isLoading ? (
          <Loader2 className="mx-auto size-6 animate-spin text-faint" />
        ) : (
          <div className="space-y-3 text-center text-muted">
            <p>Diesen Stapel gibt es nicht (mehr).</p>
            <Button onClick={() => app.go({ kind: 'cards' })}>Zu den Karteikarten</Button>
          </div>
        )}
      </Page>
    )
  }

  const scope = `deck:${deck.id}` as const

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true)
    try {
      await action()
      toast.success(done)
      setDialog(null)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page>
      <PageHeader
        breadcrumb={
          <button type="button" onClick={() => app.go({ kind: 'cards' })} className="mb-2 flex items-center gap-1 text-sm text-muted hover:text-fg">
            <Layers className="size-3.5" /> Karteikarten <ChevronRight className="size-3.5" />
          </button>
        }
        title={deck.name}
        subtitle={deck.description || `${cards.length} ${cards.length === 1 ? 'Karte' : 'Karten'}`}
        actions={
          <Menu
            trigger={(p) => (
              <Button variant="ghost" size="icon-sm" aria-label="Stapel-Aktionen" {...p}>
                <MoreVertical className="size-4" />
              </Button>
            )}
          >
            <MenuItem icon={<Settings2 />} onSelect={() => setDialog('settings')}>
              Stapel bearbeiten …
            </MenuItem>
            <MenuItem icon={<Upload />} onSelect={() => setDialog('import')}>
              Karten importieren …
            </MenuItem>
            <MenuItem
              icon={<Copy />}
              onSelect={async () => {
                const ok = await copyText(deckToMarkdown(deck, cards))
                if (ok) toast.success('Als Markdown kopiert – in Obsidian mit dem Plugin „Spaced Repetition“ lernbar.')
                else toast.error('Kopieren nicht möglich.')
              }}
            >
              Als Markdown kopieren
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<RotateCcw />} onSelect={() => setDialog('reset')}>
              Lernstand zurücksetzen …
            </MenuItem>
            <MenuItem icon={<Trash2 />} danger onSelect={() => setDialog('delete')}>
              Stapel löschen …
            </MenuItem>
          </Menu>
        }
      />

      <div className="mb-6 rounded-xl border border-border bg-elevated p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div>
            <p className="text-3xl font-bold tabular-nums">{counts.due}</p>
            <p className="text-sm text-muted">heute fällig</p>
          </div>
          <div className="text-sm text-muted">
            <p>
              <span className="font-medium text-accent-text tabular-nums">{counts.newToday}</span> neu ·{' '}
              <span className="font-medium text-warning tabular-nums">{counts.learning}</span> lernend ·{' '}
              <span className="font-medium text-success tabular-nums">{counts.review}</span> Wiederholungen
            </p>
            <p>
              Morgen fällig: {counts.dueTomorrow} · heute gelernt: {counts.reviewedToday}
            </p>
          </div>
          <div className="flex flex-1 justify-end gap-2 max-sm:w-full">
            <Button
              variant="primary"
              className="max-sm:flex-1"
              onClick={() => app.go({ kind: 'study', scope, mode: 'learn' })}
              disabled={cards.length === 0}
              data-testid="deck-learn"
            >
              <GraduationCap className="size-4" /> Lernen
            </Button>
            <Button className="max-sm:flex-1" onClick={() => app.go({ kind: 'study', scope, mode: 'practice' })} disabled={cards.length === 0}>
              <Dumbbell className="size-4" /> Üben
            </Button>
          </div>
        </div>
        {cards.length > 0 ? (
          <div className="mt-4 space-y-2">
            <ProgressBar counts={status} />
            <Legend counts={status} />
          </div>
        ) : null}
      </div>

      <div className="mb-3 flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setLimit(PAGE)
            }}
            placeholder="Karten durchsuchen …"
            aria-label="Karten durchsuchen"
            className="h-9 w-full rounded-md border border-border bg-elevated pr-3 pl-9 text-sm outline-none placeholder:text-faint focus:border-accent focus:ring-3 focus:ring-accent/20"
          />
        </div>
        <Button variant="primary" size="sm" onClick={() => app.openCardEditor({ deckId: deck.id })} data-testid="add-card">
          <Plus className="size-4" /> Karte
        </Button>
      </div>

      {cards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-strong px-6 py-10 text-center text-sm text-muted">
          <p className="font-medium text-fg">Noch keine Karten in diesem Stapel</p>
          <p className="mx-auto mt-1 max-w-md">
            Lege Karten einzeln an, importiere eine Liste – oder öffne eine Notiz und wähle im Menü ⋮ „Karteikarten aus Notiz“.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="primary" size="sm" onClick={() => app.openCardEditor({ deckId: deck.id })}>
              <Plus className="size-4" /> Karte anlegen
            </Button>
            <Button size="sm" onClick={() => setDialog('import')}>
              <Upload className="size-4" /> Importieren
            </Button>
          </div>
        </div>
      ) : (
        <ul className="space-y-2" data-testid="card-list">
          {filtered.slice(0, limit).map((card) => {
            const due = dueLabel(card, data.states, now)
            const noteTitle = card.noteId ? noteTitles.get(card.noteId) : undefined
            return (
              <li key={card.id} className="group rounded-xl border border-border bg-elevated p-3 sm:p-4">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <CardMarkdown text={card.front} className="line-clamp-4 font-medium" />
                    <CardMarkdown
                      text={card.type === 'mc' ? card.options.map((o) => (o.correct ? `✓ ${o.text}` : o.text)).join(' · ') : card.back}
                      className="mt-1 line-clamp-2 text-sm text-muted"
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge>{CARD_TYPE_LABELS[card.type]}</Badge>
                      <Badge tone={due.tone}>{due.text}</Badge>
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
                  </div>
                  <div className="flex shrink-0 gap-0.5">
                    <Button variant="ghost" size="icon-sm" onClick={() => app.openCardEditor({ card })} aria-label="Karte bearbeiten" title="Bearbeiten">
                      <Pencil className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => setToDelete(card)} aria-label="Karte löschen" title="Löschen">
                      <Trash2 className="size-4 text-danger" />
                    </Button>
                  </div>
                </div>
              </li>
            )
          })}
          {filtered.length === 0 ? <li className="py-6 text-center text-sm text-muted">Keine Karte passt zur Suche.</li> : null}
          {filtered.length > limit ? (
            <li className="text-center">
              <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
                Weitere {Math.min(PAGE, filtered.length - limit)} anzeigen
              </Button>
            </li>
          ) : null}
        </ul>
      )}

      {dialog === 'settings' ? <DeckSettingsDialog deck={deck} onClose={() => setDialog(null)} /> : null}
      {dialog === 'import' ? <ImportCardsDialog deck={deck} onClose={() => setDialog(null)} /> : null}
      <ConfirmModal
        open={dialog === 'reset'}
        onClose={() => setDialog(null)}
        title="Lernstand zurücksetzen?"
        description="Alle Karten dieses Stapels gelten danach wieder als neu. Die Karten selbst bleiben erhalten."
        confirmLabel="Zurücksetzen"
        danger
        loading={busy}
        onConfirm={() => void run(() => resetDeckProgress(qc, deck.id), 'Lernstand zurückgesetzt.')}
      />
      <ConfirmModal
        open={dialog === 'delete'}
        onClose={() => setDialog(null)}
        title="Stapel löschen?"
        description={`„${deck.name}“ wird mit ${cards.length} ${cards.length === 1 ? 'Karte' : 'Karten'} und dem Lernstand endgültig gelöscht.`}
        confirmLabel="Löschen"
        danger
        loading={busy}
        onConfirm={() =>
          void run(async () => {
            await deleteDeck(qc, deck.id)
            app.go({ kind: 'cards' }, { replace: true })
          }, 'Stapel gelöscht.')
        }
      />
      <ConfirmModal
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title="Karte löschen?"
        description="Die Karte und ihr Lernstand werden endgültig gelöscht."
        confirmLabel="Löschen"
        danger
        onConfirm={async () => {
          if (!toDelete) return
          try {
            await deleteCard(qc, toDelete.id)
          } catch (err) {
            toast.error(errorMessage(err))
          }
          setToDelete(null)
        }}
      />
    </Page>
  )
}
