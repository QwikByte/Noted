'use client'
import { useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Copy,
  Dumbbell,
  FileArchive,
  GraduationCap,
  Layers,
  Loader2,
  MoreVertical,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Settings2,
  Trash2,
  Upload,
} from 'lucide-react'
import { useApp } from '@/features/workspace/client/context'
import { Page, PageHeader } from '@/shared/ui/page-layout'
import { usePrintShortcut } from '@/shared/ui/print-view'
import { CardRow } from './CardRow'
import { useCardActions } from './CardActions'
import { PracticeMenu } from './PracticeMenu'
import { DeckPrint } from './DeckPrint'
import { Legend, ProgressBar, statusCounts } from './common'
import { useNow } from '@/shared/client/now'
import { DeckSettingsDialog, ImportCardsDialog } from './DeckDialogs'
import { Button } from '@/shared/ui/button'
import { Menu, MenuItem, MenuSeparator, useContextMenu } from '@/shared/ui/menu'
import { ConfirmModal } from '@/shared/ui/modal'
import { useToast } from '@/shared/ui/toast'
import { cn } from '@/shared/ui/cn'
import { SelectButton } from '@/shared/ui/selection-bar'
import { useListSelection } from '@/shared/client/list-selection'
import { deleteDeck, resetDeckProgress, updateDeck, useFlashcards } from '../client/flashcards'
import { useNotes } from '@/features/notes/client/queries'
import { copyText } from '@/shared/client/clipboard'
import { errorMessage } from '@/shared/client/api'
import { deckToMarkdown } from '../card-markdown'
import { daysUntil, examNewPerDay, nextExam } from '../exam'
import { cardMatches } from '../browse'
import { MAX_NEW_PER_DAY } from '../limits'
import { longDate } from '@/features/calendar/dates'
import { byPosition, deckCounts, isProblemCard, type DeckCounts } from '../study'
import type { Deck, DeckExam } from '../types'

const PAGE = 100

type CardFilter = 'all' | 'problem' | 'suspended'

export function DeckView({ id }: { id: string }) {
  const app = useApp()
  const qc = useQueryClient()
  const toast = useToast()
  const { data, isLoading } = useFlashcards()
  const { notes } = useNotes()
  const now = useNow()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<CardFilter>('all')
  const [limit, setLimit] = useState(PAGE)
  const [dialog, setDialog] = useState<'settings' | 'import' | 'reset' | 'delete' | 'print' | null>(null)
  const [busy, setBusy] = useState(false)
  const openContextMenu = useContextMenu()

  const deck = data?.decks.find((d) => d.id === id)
  const cards = useMemo(() => (data ? data.cards.filter((c) => c.deckId === id).sort(byPosition) : []), [data, id])
  const counts = data && deck ? deckCounts(deck, cards, data.states, now) : null
  const exam = nextExam(deck?.exams, now)
  const status = useMemo(() => statusCounts(cards, data?.states ?? new Map()), [cards, data])
  const noteTitles = useMemo(() => new Map(notes.map((n) => [n.id, n.title])), [notes])
  const leechLapses = deck?.leechLapses
  const problems = useMemo(
    () => new Set(data ? cards.filter((c) => isProblemCard(c, data.states, leechLapses)).map((c) => c.id) : []),
    [cards, data, leechLapses],
  )
  const suspended = cards.filter((c) => c.suspended).length
  // Ist der Filter leer geworden (z. B. alle Problemkarten neu gelernt), wieder alle Karten zeigen
  const shownFilter: CardFilter =
    (filter === 'problem' && problems.size === 0) || (filter === 'suspended' && suspended === 0) ? 'all' : filter

  const filtered = useMemo(() => {
    const pool =
      shownFilter === 'problem' ? cards.filter((c) => problems.has(c.id)) : shownFilter === 'suspended' ? cards.filter((c) => c.suspended) : cards
    return pool.filter((c) => cardMatches(c, query))
  }, [cards, query, shownFilter, problems])
  usePrintShortcut(cards.length > 0 ? () => setDialog('print') : null)
  // Mehrfachauswahl wie in Notizlisten – über alle Karten der Liste, nicht nur die angezeigten
  const order = useMemo(() => filtered.map((c) => c.id), [filtered])
  const listRoot = useRef<HTMLDivElement>(null)
  const selection = useListSelection({ order, resetKey: `${id}:${query}:${shownFilter}`, root: listRoot })
  const cardList = useCardActions(selection)

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

  // Dieselben Einträge im Menü „…“ und beim Rechtsklick auf die freie Fläche
  const deckItems = (
    <>
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
          if (ok) toast.success('Als Markdown kopiert.')
          else toast.error('Kopieren nicht möglich.')
        }}
      >
        Als Markdown kopieren
      </MenuItem>
      <MenuItem
        icon={<FileArchive />}
        onSelect={() => {
          // Mit Bildern und Einstellungen – zum Weitergeben an andere Konten
          const a = document.createElement('a')
          a.href = `/api/decks/${deck.id}/export`
          a.download = ''
          a.click()
        }}
      >
        Als Datei exportieren
      </MenuItem>
      <MenuItem icon={<Printer />} onSelect={() => setDialog('print')} disabled={cards.length === 0} hint="Strg+P">
        Drucken …
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<RotateCcw />} onSelect={() => setDialog('reset')}>
        Lernstand zurücksetzen …
      </MenuItem>
      <MenuItem icon={<Trash2 />} danger onSelect={() => setDialog('delete')}>
        Stapel löschen …
      </MenuItem>
    </>
  )

  return (
    <Page
      onContextMenu={(e) =>
        openContextMenu(
          e,
          <>
            <MenuItem icon={<Plus />} onSelect={() => app.openCardEditor({ deckId: deck.id })}>
              Karte anlegen …
            </MenuItem>
            <MenuSeparator />
            {deckItems}
          </>,
          { text: true, copy: true },
        )
      }
    >
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
            {deckItems}
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
            <PracticeMenu
              scope={scope}
              cards={cards}
              states={data.states}
              trigger={(p) => (
                <Button className="max-sm:flex-1" disabled={cards.length === 0} {...p}>
                  <Dumbbell className="size-4" /> Üben <ChevronDown className="size-3.5" />
                </Button>
              )}
            />
          </div>
        </div>
        {cards.length > 0 ? (
          <div className="mt-4 space-y-2">
            <ProgressBar counts={status} />
            <Legend counts={status} />
          </div>
        ) : null}
        {exam && cards.length > 0 ? <ExamPlan deck={deck} counts={counts} exam={exam} now={now} /> : null}
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
        <SelectButton selection={selection} />
        <Button variant="primary" size="sm" onClick={() => app.openCardEditor({ deckId: deck.id })} data-testid="add-card">
          <Plus className="size-4" /> Karte
        </Button>
      </div>

      {problems.size > 0 || suspended > 0 ? (
        <div className="mb-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Karten filtern">
          {(
            [
              ['all', 'Alle', cards.length],
              ['problem', 'Problemkarten', problems.size],
              ['suspended', 'Ausgesetzt', suspended],
            ] as const
          )
            .filter(([value, , n]) => value === 'all' || n > 0)
            .map(([value, label, n]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={shownFilter === value}
                onClick={() => {
                  setFilter(value)
                  setLimit(PAGE)
                }}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors',
                  shownFilter === value ? 'border-accent bg-accent-soft font-medium text-accent-text' : 'border-border text-muted hover:bg-hover hover:text-fg',
                )}
              >
                {value === 'problem' ? <AlertTriangle className="size-3.5 text-warning" /> : null}
                {label} <span className="tabular-nums">{n}</span>
              </button>
            ))}
        </div>
      ) : null}
      {shownFilter === 'problem' ? (
        <p className="mb-3 rounded-xl bg-warning-soft px-4 py-3 text-sm text-fg" data-testid="problem-hint">
          Mindestens {deck?.leechLapses}-mal vergessen – meist ist die Karte zu umfangreich oder unklar. Überarbeite oder teile
          sie und lerne sie neu; bis dahin kannst du sie aussetzen.
        </p>
      ) : null}

      {cards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-strong px-6 py-10 text-center text-sm text-muted">
          <p className="font-medium text-fg">Noch keine Karten in diesem Stapel</p>
          <p className="mx-auto mt-1 max-w-md">
            Oder aus einer Notiz: Menü ⋮ → „Karteikarten aus Notiz“.
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
        <div ref={listRoot}>
          {cardList.bar}
          <ul className="space-y-2" data-testid="card-list">
            {filtered.slice(0, limit).map((card) => (
              <CardRow
                key={card.id}
                card={card}
                states={data.states}
                now={now}
                exam={exam}
                noteTitle={card.noteId ? noteTitles.get(card.noteId) : undefined}
                problem={problems.has(card.id)}
                actions={cardList.rowActions}
                selection={selection}
                listOrder={order}
                selectionMenu={cardList.menu}
              />
            ))}
            {filtered.length === 0 ? <li className="py-6 text-center text-sm text-muted">Keine Karte passt zur Suche.</li> : null}
            {filtered.length > limit ? (
              <li className="text-center">
                <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
                  Weitere {Math.min(PAGE, filtered.length - limit)} anzeigen
                </Button>
              </li>
            ) : null}
          </ul>
        </div>
      )}

      {dialog === 'settings' ? <DeckSettingsDialog deck={deck} onClose={() => setDialog(null)} /> : null}
      {dialog === 'import' ? <ImportCardsDialog deck={deck} onClose={() => setDialog(null)} /> : null}
      {/* Gedruckt wird, was die Liste zeigt – mit Suche und Filter, aber alle Karten statt der ersten 100 */}
      {dialog === 'print' ? <DeckPrint deck={deck} cards={filtered} onClose={() => setDialog(null)} /> : null}
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
      {cardList.dialogs}
    </Page>
  )
}

/** Klausurmodus: Was bis zur Klausur passiert – und wie viele neue Karten pro Tag es braucht, um alle zu schaffen */
function ExamPlan({ deck, counts, exam, now }: { deck: Deck; counts: DeckCounts; exam: DeckExam; now: number }) {
  const qc = useQueryClient()
  const toast = useToast()
  const days = daysUntil(exam, now)
  const perDay = Math.min(MAX_NEW_PER_DAY, examNewPerDay(counts.newTotal, counts.introducedToday, exam, now))
  const short = counts.newTotal > 0 && perDay > deck.newPerDay
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-3 text-sm" data-testid="exam-plan">
      <CalendarClock className="size-4 shrink-0 text-accent-text" />
      <p className="min-w-0 flex-1 break-words text-muted">
        <span className="font-medium text-fg">{exam.title}</span> {days === 1 ? 'morgen' : `in ${days} Tagen`} ({longDate(exam.date)}):
        Bis dahin kommt jede gelernte Karte noch einmal dran.
        {counts.newTotal === 0
          ? null
          : short
            ? ` Um alle ${counts.newTotal} neuen Karten rechtzeitig einmal zu lernen, sind ${perDay} pro Tag nötig (Tageslimit: ${deck.newPerDay}).`
            : ` Mit ${deck.newPerDay} neuen Karten pro Tag lernst du alle ${counts.newTotal} neuen rechtzeitig.`}
      </p>
      {short ? (
        <Button
          size="sm"
          onClick={() =>
            void updateDeck(qc, deck.id, { newPerDay: perDay })
              .then(() => toast.success(`Tageslimit: ${perDay} neue Karten.`))
              .catch((err: unknown) => toast.error(errorMessage(err)))
          }
        >
          {perDay} pro Tag übernehmen
        </Button>
      ) : null}
    </div>
  )
}
