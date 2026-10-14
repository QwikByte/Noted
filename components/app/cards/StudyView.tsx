'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, CheckCircle2, Dumbbell, FileText, Loader2, Pencil, RotateCcw, X, XCircle } from 'lucide-react'
import { useApp } from '../context'
import { CardMarkdown } from './CardMarkdown'
import { useNow } from './common'
import { Button } from '../../ui/button'
import { cn } from '../../ui/cn'
import { errorMessage } from '@/lib/client/api'
import { reviewQueue, useFlashcards, type Flashcards } from '@/lib/client/flashcards'
import { useNotes } from '@/lib/client/queries'
import type { StudyMode, StudyScope, View } from '@/lib/client/nav'
import { formatInterval, previewIntervals, RATINGS, schedule, type Rating } from '@/lib/shared/srs'
import {
  LearnSession,
  PracticeSession,
  allItems,
  deckCounts,
  isCorrectSelection,
  itemKey,
  shuffle,
  type ItemKind,
  type StudyItem,
} from '@/lib/shared/study'
import type { Card, Deck } from '@/lib/shared/types'

type Scope = { title: string; decks: Deck[]; cards: Card[]; back: View }

function resolveScope(data: Flashcards, scope: StudyScope, noteTitle: (id: string) => string | undefined): Scope | null {
  if (scope === 'all') return { title: 'Alle Stapel', decks: data.decks, cards: data.cards, back: { kind: 'cards' } }
  const [kind, id] = scope.split(':') as ['deck' | 'note', string]
  if (kind === 'deck') {
    const deck = data.decks.find((d) => d.id === id)
    if (!deck) return null
    return { title: deck.name, decks: [deck], cards: data.cards.filter((c) => c.deckId === id), back: { kind: 'deck', id } }
  }
  const cards = data.cards.filter((c) => c.noteId === id)
  const deckIds = new Set(cards.map((c) => c.deckId))
  return {
    title: noteTitle(id) ?? 'Notiz',
    decks: data.decks.filter((d) => deckIds.has(d.id)),
    cards,
    back: { kind: 'note', id },
  }
}

export function StudyView({ scope, mode }: { scope: StudyScope; mode: StudyMode }) {
  const app = useApp()
  const { data, isLoading, error } = useFlashcards()
  const { notes } = useNotes()
  const titleOf = useCallback((id: string) => notes.find((n) => n.id === id)?.title, [notes])
  // Sitzung einmalig aus dem Stand beim Öffnen aufbauen – spätere Änderungen (z. B. gesendete Bewertungen)
  // sollen die laufende Reihenfolge nicht durcheinanderbringen
  const [snapshot, setSnapshot] = useState<{ data: Flashcards; scope: Scope } | null>(null)
  if (!snapshot && data) {
    const resolved = resolveScope(data, scope, titleOf)
    if (resolved) setSnapshot({ data, scope: resolved })
  }

  if (!snapshot) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-muted">
        {isLoading ? (
          <Loader2 className="size-6 animate-spin" />
        ) : (
          <>
            <p>{data ? 'Diesen Stapel gibt es nicht (mehr).' : `Die Karteikarten konnten nicht geladen werden. ${errorMessage(error)}`}</p>
            <Button onClick={() => app.go({ kind: 'cards' })}>Zu den Karteikarten</Button>
          </>
        )}
      </div>
    )
  }
  return <StudySession key={`${scope}:${mode}`} mode={mode} scope={scope} snapshot={snapshot} live={data ?? snapshot.data} />
}

type Answer = { selected: Set<number>; checked: boolean; order: number[] }

const take = (s: LearnSession | PracticeSession) => (s instanceof LearnSession ? s.next(Date.now()) : s.next())

/** Neue Antwort: Reihenfolge der Multiple-Choice-Antworten jedes Mal neu mischen */
const freshAnswer = (item: StudyItem | null): Answer => ({
  selected: new Set(),
  checked: false,
  order: item ? shuffle(item.card.options.map((_, i) => i)) : [],
})

function StudySession({
  mode,
  scope,
  snapshot,
  live,
}: {
  mode: StudyMode
  scope: StudyScope
  snapshot: { data: Flashcards; scope: Scope }
  live: Flashcards
}) {
  const app = useApp()
  const { notes } = useNotes()
  const { title, back } = snapshot.scope

  const create = useCallback(
    (items?: StudyItem[]): LearnSession | PracticeSession =>
      mode === 'learn'
        ? new LearnSession(snapshot.scope.decks, snapshot.scope.cards, snapshot.data.states, Date.now())
        : new PracticeSession(items ?? allItems(snapshot.scope.cards)),
    [mode, snapshot],
  )
  const [init] = useState(() => {
    const session = create()
    return { session, first: take(session) }
  })
  const [session, setSession] = useState(init.session)
  const [current, setCurrent] = useState<StudyItem | null>(init.first)
  const [revealed, setRevealed] = useState(false)
  const [answer, setAnswer] = useState<Answer>(() => freshAnswer(init.first))
  const [reviewed, setReviewed] = useState(0)
  // Verschiedene Karten dieser Sitzung (Karten in der Lernphase kommen mehrfach dran)
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set())
  // Zeitpunkt, zu dem die Karte angezeigt wurde (für die Abstände auf den Bewertungsknöpfen)
  const [shownAt, setShownAt] = useState(() => Date.now())

  const advance = useCallback((s: LearnSession | PracticeSession) => {
    const next = take(s)
    setShownAt(Date.now())
    setCurrent(next)
    setRevealed(false)
    setAnswer(freshAnswer(next))
  }, [])

  const restart = (items: StudyItem[]) => {
    const s = create(items)
    setSession(s)
    setReviewed(0)
    setSeen(new Set())
    advance(s)
  }

  // Immer die aktuelle Fassung der Karte anzeigen (falls sie gerade bearbeitet wurde)
  const card = current ? (live.cards.find((c) => c.id === current.card.id) ?? current.card) : null
  const side = current?.side ?? 0
  const state = current ? (live.states.get(itemKey(current)) ?? null) : null
  const isMc = card?.type === 'mc' && card.options.length >= 2
  const singleChoice = isMc && card!.options.filter((o) => o.correct).length === 1
  const correct = isMc && answer.checked ? isCorrectSelection(card!.options, answer.selected) : null
  const intervals = useMemo(() => (current && mode === 'learn' ? previewIntervals(state, shownAt) : null), [current, state, mode, shownAt])

  const rate = useCallback(
    (rating: Rating) => {
      if (!current || !(session instanceof LearnSession)) return
      const now = Date.now()
      const next = schedule(state, rating, now)
      reviewQueue.add({ cardId: current.card.id, side: current.side, ...next })
      session.answered(current, next, now)
      setReviewed((n) => n + 1)
      setSeen((prev) => new Set(prev).add(itemKey(current)))
      advance(session)
    },
    [current, state, session, advance],
  )

  const practiceAnswer = useCallback(
    (ok: boolean) => {
      if (!current || !(session instanceof PracticeSession)) return
      session.answered(current, ok)
      setReviewed((n) => n + 1)
      advance(session)
    },
    [current, session, advance],
  )

  const toggleOption = useCallback(
    (index: number) => {
      if (answer.checked) return
      setAnswer((a) => {
        const selected = new Set(singleChoice ? [] : a.selected)
        if (a.selected.has(index) && !singleChoice) selected.delete(index)
        else selected.add(index)
        return { ...a, selected }
      })
    },
    [answer.checked, singleChoice],
  )

  const check = useCallback(() => {
    if (!isMc || answer.selected.size === 0) return
    setAnswer((a) => ({ ...a, checked: true }))
    setRevealed(true)
  }, [isMc, answer.selected.size])

  // Tastatur: Leertaste/Enter = aufdecken bzw. „Gut“, 1–4 = Bewertung, bei Multiple Choice 1–9 = Antwort wählen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!current || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable="true"], dialog[open], [role="menu"]')) return
      const primary = e.key === ' ' || e.key === 'Enter'
      const digit = /^[1-9]$/.test(e.key) ? Number(e.key) : null
      let handled = true
      if (isMc && !answer.checked) {
        if (digit && digit <= answer.order.length) toggleOption(answer.order[digit - 1])
        else if (primary) check()
        else handled = false
      } else if (!revealed) {
        if (primary) setRevealed(true)
        else handled = false
      } else if (mode === 'learn') {
        if (isMc && correct === false) {
          if (primary || digit === 1) rate(1)
          else handled = false
        } else if (primary) rate(3)
        else if (digit && digit <= 4 && !(isMc && digit === 1)) rate(digit as Rating)
        else handled = false
      } else if (isMc) {
        if (primary) practiceAnswer(!!correct)
        else handled = false
      } else if (digit === 1) practiceAnswer(false)
      else if (digit === 2 || primary) practiceAnswer(true)
      else handled = false
      if (handled) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, isMc, answer, revealed, mode, correct, toggleOption, check, rate, practiceAnswer])

  const close = () => app.go(back, { replace: true })
  const remaining: Record<ItemKind, number> | null = session instanceof LearnSession ? session.remaining() : null
  if (remaining && current) remaining[current.kind === 'new' ? 'new' : current.kind]++
  const progress =
    session instanceof LearnSession
      ? reviewed / Math.max(1, reviewed + session.size + (current ? 1 : 0))
      : session.done.size / Math.max(1, session.total)
  const note = card?.noteId ? notes.find((n) => n.id === card.noteId) : undefined

  const question = !card ? '' : isMc ? card.front : side === 1 ? card.back : card.front
  const solution = !card ? '' : isMc ? card.back : side === 1 ? card.front : card.back

  return (
    <div className="flex h-full flex-col" data-testid="study">
      <header className="pt-safe border-b border-border">
        <div className="flex items-center gap-2 px-2 py-1.5 sm:px-3">
          <Button variant="ghost" size="icon" onClick={close} aria-label="Lernen beenden" title="Beenden">
            <X className="size-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{title}</p>
            <p className="text-xs text-muted">{mode === 'learn' ? 'Lernen' : 'Üben – ohne Einfluss auf den Lernplan'}</p>
          </div>
          {remaining ? (
            <div className="flex items-center gap-2.5 text-sm font-semibold tabular-nums" aria-label="Verbleibend">
              <span className="text-accent-text" title="Neu">
                {remaining.new}
              </span>
              <span className="text-warning" title="In der Lernphase">
                {remaining.learning}
              </span>
              <span className="text-success" title="Wiederholungen">
                {remaining.review}
              </span>
            </div>
          ) : session instanceof PracticeSession ? (
            <span className="text-sm text-muted tabular-nums" title="Gewusst / Karten">
              {session.done.size} / {session.total}
            </span>
          ) : null}
          {card ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => app.openCardEditor({ card })}
              aria-label="Karte bearbeiten"
              title="Karte bearbeiten"
            >
              <Pencil className="size-4" />
            </Button>
          ) : null}
        </div>
        <div className="h-0.5 bg-subtle">
          <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
        </div>
      </header>

      {!current || !card ? (
        <Finished
          scope={scope}
          reviewed={reviewed}
          cardsSeen={seen.size}
          session={session}
          snapshot={snapshot}
          live={live}
          onBack={close}
          onRestart={restart}
        />
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-10">
              <div className="rounded-2xl border border-border bg-elevated p-5 shadow-card sm:p-7" data-testid="study-card">
                <div className="mb-3 flex items-center gap-2 text-xs text-faint">
                  {current.kind === 'new' ? <span className="rounded-full bg-accent-soft px-2 py-0.5 text-accent-text">Neu</span> : null}
                  {card.type === 'reversed' ? <span>{side === 1 ? 'Rückseite → Vorderseite' : 'Vorderseite → Rückseite'}</span> : null}
                  {isMc ? <span>{singleChoice ? 'Eine Antwort ist richtig' : 'Mehrere Antworten können richtig sein'}</span> : null}
                </div>
                <CardMarkdown text={question} className="study-question" />

                {isMc ? (
                  <ul className="mt-5 space-y-2" role={singleChoice ? 'radiogroup' : 'group'} aria-label="Antworten">
                    {answer.order.map((optIndex, pos) => {
                      const option = card.options[optIndex]
                      const selected = answer.selected.has(optIndex)
                      const state = !answer.checked
                        ? selected
                          ? 'selected'
                          : 'idle'
                        : option.correct
                          ? selected
                            ? 'right'
                            : 'missed'
                          : selected
                            ? 'wrong'
                            : 'idle'
                      return (
                        <li key={optIndex}>
                          <button
                            type="button"
                            role={singleChoice ? 'radio' : 'checkbox'}
                            aria-checked={selected}
                            disabled={answer.checked}
                            onClick={() => toggleOption(optIndex)}
                            className={cn(
                              'flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors disabled:cursor-default',
                              state === 'idle' && 'border-border hover:border-border-strong hover:bg-hover',
                              state === 'selected' && 'border-accent bg-accent-soft',
                              state === 'right' && 'border-success bg-success-soft',
                              state === 'missed' && 'border-success border-dashed',
                              state === 'wrong' && 'border-danger bg-danger-soft',
                            )}
                          >
                            <span
                              className={cn(
                                'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border text-xs font-semibold',
                                singleChoice && 'rounded-full',
                                state === 'selected' ? 'border-accent bg-accent text-white' : 'border-border-strong text-muted',
                                state === 'right' && 'border-success bg-success text-white',
                                state === 'wrong' && 'border-danger bg-danger text-white',
                                state === 'missed' && 'border-success text-success',
                              )}
                              aria-hidden
                            >
                              {state === 'right' || state === 'missed' ? (
                                <Check className="size-3.5" />
                              ) : state === 'wrong' ? (
                                <X className="size-3.5" />
                              ) : (
                                pos + 1
                              )}
                            </span>
                            <CardMarkdown text={option.text} className="min-w-0 flex-1" />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}

                {revealed ? (
                  <div className="mt-5 border-t border-border pt-5" data-testid="study-answer">
                    {isMc ? (
                      <p className={cn('mb-3 flex items-center gap-2 font-semibold', correct ? 'text-success' : 'text-danger')}>
                        {correct ? <CheckCircle2 className="size-5" /> : <XCircle className="size-5" />}
                        {correct ? 'Richtig!' : 'Leider falsch.'}
                      </p>
                    ) : null}
                    {solution.trim() ? <CardMarkdown text={solution} /> : null}
                    {note ? (
                      <button
                        type="button"
                        onClick={() => app.go({ kind: 'note', id: note.id })}
                        className="mt-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"
                      >
                        <FileText className="size-4" /> {note.title}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="pb-safe border-t border-border bg-bg">
            <div className="mx-auto flex w-full max-w-2xl gap-2 px-4 py-3">
              {isMc && !answer.checked ? (
                <Button variant="primary" size="lg" className="flex-1" onClick={check} disabled={answer.selected.size === 0}>
                  Prüfen
                </Button>
              ) : !revealed ? (
                <Button variant="primary" size="lg" className="flex-1" onClick={() => setRevealed(true)} data-testid="reveal">
                  Antwort zeigen
                </Button>
              ) : mode === 'learn' && intervals ? (
                isMc && correct === false ? (
                  <RatingButton rating={1} label="Weiter" hint={formatInterval(intervals[1])} onClick={rate} wide />
                ) : (
                  RATINGS.filter((r) => !(isMc && r.rating === 1)).map((r) => (
                    <RatingButton key={r.rating} rating={r.rating} label={r.label} hint={formatInterval(intervals[r.rating])} onClick={rate} />
                  ))
                )
              ) : isMc ? (
                <Button variant="primary" size="lg" className="flex-1" onClick={() => practiceAnswer(!!correct)}>
                  Weiter
                </Button>
              ) : (
                <>
                  <Button size="lg" className="flex-1 text-danger" onClick={() => practiceAnswer(false)}>
                    <X className="size-4" /> Nicht gewusst
                  </Button>
                  <Button size="lg" className="flex-1 text-success" onClick={() => practiceAnswer(true)}>
                    <Check className="size-4" /> Gewusst
                  </Button>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const RATING_STYLES: Record<Rating, string> = {
  1: 'text-danger',
  2: 'text-warning',
  3: 'text-success',
  4: 'text-accent-text',
}

function RatingButton({
  rating,
  label,
  hint,
  onClick,
  wide,
}: {
  rating: Rating
  label: string
  hint: string
  onClick: (r: Rating) => void
  wide?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(rating)}
      className={cn(
        'flex h-14 min-w-0 flex-1 flex-col items-center justify-center rounded-xl border border-border bg-elevated px-1 transition-colors hover:bg-hover active:scale-[0.98]',
        wide && 'flex-1',
      )}
      data-testid={`rate-${rating}`}
    >
      <span className={cn('text-sm font-semibold', RATING_STYLES[rating])}>{label}</span>
      <span className="text-xs text-faint">{hint}</span>
    </button>
  )
}

function Finished({
  scope,
  reviewed,
  cardsSeen,
  session,
  snapshot,
  live,
  onBack,
  onRestart,
}: {
  scope: StudyScope
  reviewed: number
  cardsSeen: number
  session: LearnSession | PracticeSession
  snapshot: { data: Flashcards; scope: Scope }
  live: Flashcards
  onBack: () => void
  onRestart: (items: StudyItem[]) => void
}) {
  const app = useApp()
  const { decks, cards } = snapshot.scope
  const now = useNow()
  const counts = decks.map((d) =>
    deckCounts(
      d,
      cards.filter((c) => c.deckId === d.id),
      live.states,
      now,
    ),
  )
  const dueTomorrow = counts.reduce((s, c) => s + c.dueTomorrow, 0)
  const newLeft = counts.reduce((s, c) => s + c.newTotal, 0)

  if (session instanceof PracticeSession) {
    const items = allItems(cards)
    const missed = session.missed(items)
    const pct = session.total ? Math.round((session.correctFirstTry / session.total) * 100) : 0
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-accent-soft text-accent-text">
          <Dumbbell className="size-8" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">{session.total === 0 ? 'Keine Karten' : 'Übung beendet'}</h2>
          {session.total > 0 ? (
            <p className="mt-1 text-muted">
              Beim ersten Versuch richtig: <strong className="text-fg">{session.correctFirstTry}</strong> von {session.total} ({pct} %)
            </p>
          ) : (
            <p className="mt-1 text-muted">Hier gibt es noch keine Karten zum Üben.</p>
          )}
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {missed.length > 0 ? (
            <Button variant="primary" onClick={() => onRestart(missed)}>
              <RotateCcw className="size-4" /> Fehler wiederholen ({missed.length})
            </Button>
          ) : null}
          {session.total > 0 ? <Button onClick={() => onRestart(items)}>Alle nochmal</Button> : null}
          <Button onClick={onBack}>Zurück</Button>
        </div>
      </div>
    )
  }

  const nothingToDo = reviewed === 0
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center" data-testid="study-done">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-success-soft text-success">
        <CheckCircle2 className="size-8" />
      </div>
      <div className="max-w-md">
        <h2 className="text-2xl font-bold">{nothingToDo ? 'Für heute ist alles gelernt' : 'Geschafft!'}</h2>
        <p className="mt-1 text-muted">
          {nothingToDo
            ? cards.length === 0
              ? 'Hier gibt es noch keine Karten.'
              : 'Gerade ist keine Karte fällig.'
            : `Du hast ${cardsSeen} ${cardsSeen === 1 ? 'Karte' : 'Karten'} gelernt (${reviewed} ${reviewed === 1 ? 'Antwort' : 'Antworten'}).`}{' '}
          {dueTomorrow > 0 ? `Morgen ${dueTomorrow === 1 ? 'ist 1 Karte' : `sind ${dueTomorrow} Karten`} fällig.` : null}
        </p>
        {newLeft > 0 ? (
          <p className="mt-2 text-sm text-faint">
            Noch {newLeft} neue {newLeft === 1 ? 'Karte' : 'Karten'} – das Tageslimit für neue Karten lässt sich im Stapel einstellen.
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {cards.length > 0 ? (
          <Button onClick={() => app.go({ kind: 'study', scope, mode: 'practice' }, { replace: true })}>
            <Dumbbell className="size-4" /> {nothingToDo ? 'Trotzdem üben' : 'Alle Karten üben'}
          </Button>
        ) : null}
        <Button variant="primary" onClick={onBack}>
          Fertig
        </Button>
      </div>
    </div>
  )
}
