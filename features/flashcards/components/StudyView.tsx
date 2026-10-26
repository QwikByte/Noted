'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Dumbbell,
  FileText,
  Loader2,
  Pause,
  Pencil,
  RotateCcw,
  Undo2,
  X,
  XCircle,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useApp } from '@/features/workspace/client/context'
import { CardMarkdown } from './CardMarkdown'
import { useNow } from '@/shared/client/now'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { MenuItem, useContextMenu } from '@/shared/ui/menu'
import { useReservedSpace } from '@/shared/ui/reserved-space'
import { useToast } from '@/shared/ui/toast'
import { cn } from '@/shared/ui/cn'
import { errorMessage } from '@/shared/client/api'
import { reviewQueue, updateCard, useAgainToday, useFlashcards, type Flashcards } from '../client/flashcards'
import { useNotes } from '@/features/notes/client/queries'
import type { StudyMode, StudyScope, View } from '@/features/workspace/client/nav'
import { LEECH_LAPSES, SM2, formatInterval, previewIntervals, RATINGS, schedule, type Plan, type Rating } from '../srs'
import {
  LearnSession,
  PracticeSession,
  allItems,
  deckCounts,
  filterItems,
  isCorrectSelection,
  isProblemCard,
  itemKey,
  shuffle,
  type ItemKind,
  type StudyFilter,
  type StudyItem,
} from '../study'
import { answerText, compareAnswer, type TypedResult } from '../typed-answer'
import { clozeAnswer, clozeCount, clozeQuestion, clozeText } from '../cloze'
import { reviewLogEntry } from '../stats'
import { OcclusionImage } from './Occlusion'
import { FILTER_LABELS } from './PracticeMenu'
import type { Card, Deck, SrsState } from '../types'

/** `cards`: zu lernende Karten, `pool`: alle Karten der beteiligten Stapel (für das Tageslimit neuer Karten) */
type Scope = { title: string; decks: Deck[]; cards: Card[]; pool: Card[]; back: View }

function resolveScope(data: Flashcards, scope: StudyScope, noteTitle: (id: string) => string | undefined): Scope | null {
  if (scope === 'all') return { title: 'Alle Stapel', decks: data.decks, cards: data.cards, pool: data.cards, back: { kind: 'cards' } }
  const [kind, id] = scope.split(':') as ['deck' | 'note' | 'exam', string]
  if (kind === 'exam') {
    const decks = data.decks.filter((d) => d.exams?.some((e) => e.id === id))
    const exam = decks[0]?.exams?.find((e) => e.id === id)
    if (!exam) return null
    const deckIds = new Set(decks.map((d) => d.id))
    const cards = data.cards.filter((c) => deckIds.has(c.deckId))
    return { title: exam.title, decks, cards, pool: cards, back: { kind: 'home' } }
  }
  if (kind === 'deck') {
    const deck = data.decks.find((d) => d.id === id)
    if (!deck) return null
    const cards = data.cards.filter((c) => c.deckId === id)
    return { title: deck.name, decks: [deck], cards, pool: cards, back: { kind: 'deck', id } }
  }
  const cards = data.cards.filter((c) => c.noteId === id)
  const deckIds = new Set(cards.map((c) => c.deckId))
  return {
    title: noteTitle(id) ?? 'Notiz',
    decks: data.decks.filter((d) => deckIds.has(d.id)),
    cards,
    pool: data.cards.filter((c) => deckIds.has(c.deckId)),
    back: { kind: 'note', id },
  }
}

export function StudyView({ scope, mode, filter }: { scope: StudyScope; mode: StudyMode; filter?: StudyFilter }) {
  const app = useApp()
  const { data, isLoading, error } = useFlashcards()
  const { notes } = useNotes()
  const titleOf = useCallback((id: string) => notes.find((n) => n.id === id)?.title, [notes])
  const practiceFilter = mode === 'practice' ? filter : undefined
  // „Heute vergessen“ braucht das Protokoll vom Server – ohne Verbindung nur die Bewertungen dieses Geräts
  const again = useAgainToday(practiceFilter === 'again-today')
  // Sitzung einmalig aus dem Stand beim Öffnen aufbauen – spätere Änderungen (z. B. gesendete Bewertungen)
  // sollen die laufende Reihenfolge nicht durcheinanderbringen
  const [snapshot, setSnapshot] = useState<{ data: Flashcards; scope: Scope; items?: StudyItem[] } | null>(null)
  if (!snapshot && data && !again.loading) {
    const resolved = resolveScope(data, scope, titleOf)
    if (resolved) {
      setSnapshot(
        practiceFilter
          ? {
              data,
              scope: { ...resolved, title: `${resolved.title} · ${FILTER_LABELS[practiceFilter]}` },
              items: filterItems(practiceFilter, resolved.cards, data.states, { again: again.keys }),
            }
          : { data, scope: resolved },
      )
    }
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
  return (
    <StudySession
      key={`${scope}:${mode}:${practiceFilter ?? ''}`}
      mode={mode}
      scope={scope}
      snapshot={snapshot}
      live={data ?? snapshot.data}
      notice={practiceFilter === 'again-today' && again.offline ? 'Offline – es zählen nur die Bewertungen dieses Geräts.' : undefined}
    />
  )
}

function inScope(scope: Scope): ((card: Card) => boolean) | undefined {
  if (scope.pool === scope.cards) return undefined
  const ids = new Set(scope.cards.map((c) => c.id))
  return (card) => ids.has(card.id)
}

/** Bewertung in dieser Sitzung (für „Rückgängig“): die Karte, wie sie dran war, und der Stand davor und danach */
type Rated = { item: StudyItem; previous: SrsState | null; next: SrsState }

/** `key`: Kartenseite und Fassung der Karte, für die die Antwort gilt · `typed`/`result`: eingetippte Antwort */
type Answer = { key: string; selected: Set<number>; checked: boolean; order: number[]; typed: string; result: TypedResult | null }

const take = (s: LearnSession | PracticeSession) => (s instanceof LearnSession ? s.next(Date.now()) : s.next())

const answerKey = (item: StudyItem | null, card: Card | null) => (item && card ? `${itemKey(item)}@${card.updatedAt}` : '')

/** Neue Antwort: Reihenfolge der Multiple-Choice-Antworten jedes Mal neu mischen */
const freshAnswer = (item: StudyItem | null, card: Card | null = item?.card ?? null): Answer => ({
  key: answerKey(item, card),
  selected: new Set(),
  checked: false,
  order: card ? shuffle(card.options.map((_, i) => i)) : [],
  typed: '',
  result: null,
})

function StudySession({
  mode,
  scope,
  snapshot,
  live,
  notice,
}: {
  mode: StudyMode
  scope: StudyScope
  /** `items`: Seiten einer eigenen Übung, sonst alle Karten des Bereichs */
  snapshot: { data: Flashcards; scope: Scope; items?: StudyItem[] }
  live: Flashcards
  /** Hinweis über der Karte, z. B. dass offline nur lokale Bewertungen zählen */
  notice?: string
}) {
  const app = useApp()
  const qc = useQueryClient()
  const toast = useToast()
  const openContextMenu = useContextMenu()
  const { notes } = useNotes()
  const { title, back } = snapshot.scope

  const create = useCallback(
    (items?: StudyItem[]): LearnSession | PracticeSession =>
      mode === 'learn'
        ? new LearnSession(snapshot.scope.decks, snapshot.scope.pool, snapshot.data.states, Date.now(), inScope(snapshot.scope))
        : new PracticeSession(items ?? snapshot.items ?? allItems(snapshot.scope.cards)),
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
  // Bewertungen dieser Sitzung, die jüngste zuletzt – „Rückgängig“ reicht bis zum Anfang der Sitzung
  const [history, setHistory] = useState<Rated[]>([])

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

  // Immer die aktuelle Fassung der Karte anzeigen (falls sie gerade bearbeitet wurde) – dann die Antwort neu beginnen
  const card = current ? (live.cards.find((c) => c.id === current.card.id) ?? current.card) : null
  if (answer.key !== answerKey(current, card)) {
    setAnswer(freshAnswer(current, card))
    setRevealed(false)
  }
  const side = current?.side ?? 0
  const state = current ? (live.states.get(itemKey(current)) ?? null) : null
  const isMc = card?.type === 'mc' && card.options.length >= 2
  const singleChoice = isMc && card!.options.filter((o) => o.correct).length === 1
  const correct = isMc && answer.checked ? isCorrectSelection(card!.options, answer.selected) : null
  // Wiederholungsplan des Stapels (SM-2 oder FSRS)
  const deck = card ? live.decks.find((d) => d.id === card.deckId) : undefined
  const scheduler = deck?.scheduler
  const retention = deck?.retention
  // Eigene FSRS-Gewichte des Kontos (sonst Standardwerte) – kommen mit den Karten, gelten also auch offline
  const weights = live.fsrs?.weights
  const plan = useMemo<Plan>(
    () => (scheduler === 'fsrs' && retention ? { kind: 'fsrs', retention, weights } : SM2),
    [scheduler, retention, weights],
  )
  const intervals = useMemo(
    () => (current && mode === 'learn' ? previewIntervals(state, shownAt, plan, itemKey(current)) : null),
    [current, state, mode, shownAt, plan],
  )
  const isCloze = card?.type === 'cloze'
  // Bildverdeckung: Titel über dem Bild, beim Aufdecken die Beschriftung der Fläche und der Zusatz
  const occlusion = card?.type === 'occlusion' ? card.occlusion : null
  const maskLabel = occlusion?.masks[side]?.label ?? ''
  // Lückentext: Die Lücke wird beim Aufdecken im Satz ausgefüllt, darunter steht nur der Zusatz
  const question = !card
    ? ''
    : isCloze
      ? revealed
        ? clozeAnswer(card.front, side)
        : clozeQuestion(card.front, side)
      : isMc || occlusion
        ? card.front
        : side === 1
          ? card.back
          : card.front
  const solution = !card
    ? ''
    : occlusion
      ? [maskLabel && `**${maskLabel}**`, card.back].filter(Boolean).join('\n\n')
      : isMc || isCloze
        ? card.back
        : side === 1
          ? card.front
          : card.back
  // Antwort eintippen (Einstellung des Stapels) – nicht bei Multiple Choice und nicht, wenn die Antwort nur ein Bild ist
  const expected = useMemo(
    () => (card && isCloze ? answerText(clozeText(card.front, side)) : answerText(occlusion ? maskLabel : solution)),
    [card, isCloze, side, solution, occlusion, maskLabel],
  )
  const typing = !!card && card.type !== 'mc' && expected !== '' && !!deck?.typeAnswer
  // Falsch eingetippt: „Nochmal“ bzw. „Nicht gewusst“ vorauswählen, sonst wie bisher „Gut“ bzw. „Gewusst“
  const typedWrong = answer.result?.correct === false

  const rate = useCallback(
    (rating: Rating) => {
      if (!current || !(session instanceof LearnSession)) return
      const now = Date.now()
      const next = schedule(state, rating, now, plan, itemKey(current))
      if (next.lapses >= LEECH_LAPSES && !isProblemCard(current.card, live.states)) {
        toast.show(
          `${next.lapses}-mal vergessen – überarbeite oder teile die Karte (im Stapel unter „Problemkarten“).`,
          { duration: 8000 },
        )
      }
      reviewQueue.add(
        { cardId: current.card.id, side: current.side, ...next },
        reviewLogEntry(current.card.id, current.side, state, next, rating, shownAt),
      )
      session.answered(current, next, now)
      setHistory((h) => [...h, { item: current, previous: state, next }])
      setReviewed((n) => n + 1)
      setSeen((prev) => new Set(prev).add(itemKey(current)))
      advance(session)
    },
    [current, state, session, advance, live.states, toast, shownAt, plan],
  )

  /** Letzte Bewertung zurücknehmen: Die Karte kommt verdeckt wieder, mit dem Stand von vorher */
  const undo = useCallback(() => {
    const last = history[history.length - 1]
    if (!last || !(session instanceof LearnSession)) return
    const { item, previous, next } = last
    reviewQueue.undo({ cardId: item.card.id, side: item.side, reviewedAt: next.reviewedAt, previous })
    session.undo(item, current)
    const rest = history.slice(0, -1)
    setHistory(rest)
    setReviewed((n) => n - 1)
    const key = itemKey(item)
    if (!rest.some((r) => itemKey(r.item) === key)) {
      setSeen((prev) => {
        const seen = new Set(prev)
        seen.delete(key)
        return seen
      })
    }
    advance(session)
    // Fokus vom Knopf nehmen – sonst nähme die Leertaste (Aufdecken) gleich die nächste Bewertung zurück
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    toast.show('Bewertung zurückgenommen.')
  }, [history, session, current, advance, toast])

  /** Karte aussetzen: Die Sitzung geht sofort mit der nächsten weiter, auch ihre anderen Seiten kommen nicht mehr dran */
  const suspendCard = () => {
    if (!current) return
    const id = current.card.id
    session.skipCard(id)
    // Bewertungen der Karte nicht mehr zurücknehmen – sonst käme sie trotz Aussetzen wieder dran
    setHistory((h) => h.filter((r) => r.item.card.id !== id))
    advance(session)
    // Fokus vom Knopf nehmen – sonst setzte die Leertaste (Aufdecken) gleich die nächste Karte aus
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    const resume = () => void updateCard(qc, id, { suspended: false }).catch((err) => toast.error(errorMessage(err)))
    updateCard(qc, id, { suspended: true }).then(
      () => toast.show('Karte ausgesetzt – im Stapel unter „Ausgesetzt“.', { action: { label: 'Rückgängig', onClick: resume } }),
      (err) => toast.error(`Die Karte konnte nicht ausgesetzt werden: ${errorMessage(err)}`),
    )
  }

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

  /** Aufdecken – eine eingetippte Antwort wird dabei verglichen, eine leere nicht */
  const reveal = useCallback(() => {
    if (typing && answer.typed.trim()) setAnswer((a) => ({ ...a, result: compareAnswer(a.typed, expected) }))
    setRevealed(true)
  }, [typing, answer.typed, expected])

  // Werkzeugleiste und Mini-Timer bleiben über den Bewertungsknöpfen
  const bottomBar = useReservedSpace<HTMLDivElement>('--bottom-bar-height')

  // Tastatur: Leertaste/Enter = aufdecken bzw. „Gut“, 1–4 = Bewertung, bei Multiple Choice 1–9 = Antwort wählen,
  // Z oder Strg/⌘+Z = letzte Bewertung zurücknehmen
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const root = rootRef.current
      if (!root || e.altKey) return
      // Nur, wenn die Lernansicht sichtbar ist und der Fokus nicht woanders liegt (z. B. im PDF daneben)
      const t = e.target as HTMLElement
      if (!root.offsetParent || (t !== document.body && !root.contains(t))) return
      if (t.closest('input, textarea, select, [contenteditable="true"], dialog[open], [role="menu"]')) return
      // Auch nach der letzten Karte – vertippt hat man sich womöglich gerade bei ihr
      if (e.key.toLowerCase() === 'z' && !e.shiftKey && !(e.ctrlKey && e.metaKey)) {
        if (history.length === 0) return
        e.preventDefault()
        undo()
        return
      }
      if (!current || e.metaKey || e.ctrlKey) return
      const primary = e.key === ' ' || e.key === 'Enter'
      // Leertaste/Enter auf einem Knopf lösen diesen Knopf aus (z. B. „Schwer“ per Tab angewählt)
      if (primary && t.closest('button, a')) return
      const digit = /^[1-9]$/.test(e.key) ? Number(e.key) : null
      let handled = true
      if (isMc && !answer.checked) {
        if (digit && digit <= answer.order.length) toggleOption(answer.order[digit - 1])
        else if (primary) check()
        else handled = false
      } else if (!revealed) {
        if (primary) reveal()
        else handled = false
      } else if (mode === 'learn') {
        if (isMc && correct === false) {
          if (primary || digit === 1) rate(1)
          else handled = false
        } else if (primary) rate(typedWrong ? 1 : 3)
        else if (digit && digit <= 4 && !(isMc && digit === 1)) rate(digit as Rating)
        else handled = false
      } else if (isMc) {
        if (primary) practiceAnswer(!!correct)
        else handled = false
      } else if (primary) practiceAnswer(!typedWrong)
      else if (digit === 1) practiceAnswer(false)
      else if (digit === 2) practiceAnswer(true)
      else handled = false
      if (handled) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, isMc, answer, revealed, mode, correct, typedWrong, toggleOption, check, reveal, rate, practiceAnswer, history, undo])

  const close = () => app.go(back, { replace: true })
  const remaining: Record<ItemKind, number> | null = session instanceof LearnSession ? session.remaining() : null
  if (remaining && current) remaining[current.kind === 'new' ? 'new' : current.kind]++
  const progress =
    session instanceof LearnSession
      ? reviewed / Math.max(1, reviewed + session.size + (current ? 1 : 0))
      : session.done.size / Math.max(1, session.total)
  const note = card?.noteId ? notes.find((n) => n.id === card.noteId) : undefined

  return (
    <div ref={rootRef} className="flex h-full flex-col" data-testid="study">
      <header className="pt-safe border-b border-border">
        <div className="flex h-12 items-center gap-2 px-2 sm:px-3">
          <Button variant="ghost" size="icon" onClick={close} aria-label="Lernen beenden" title="Beenden">
            <X className="size-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{title}</p>
            <p className="text-xs text-muted">{mode === 'learn' ? 'Lernen' : 'Üben – ohne Einfluss auf den Lernplan'}</p>
          </div>
          {remaining ? (
            <div className="flex items-center gap-2.5 text-sm font-semibold tabular-nums" role="group" aria-label="Verbleibend">
              {/* Die Art steht sonst nur in Farbe und title – Screenreader sollen keine nackten Zahlen hören */}
              <span className="text-accent-text" title="Neu">
                {remaining.new}
                <span className="sr-only"> neu</span>
              </span>
              <span className="text-warning" title="In der Lernphase">
                {remaining.learning}
                <span className="sr-only"> in der Lernphase</span>
              </span>
              <span className="text-success" title="Wiederholungen">
                {remaining.review}
                <span className="sr-only"> Wiederholungen</span>
              </span>
            </div>
          ) : session instanceof PracticeSession ? (
            <span className="text-sm text-muted tabular-nums" title="Gewusst / Karten">
              {session.done.size} / {session.total}
            </span>
          ) : null}
          {mode === 'learn' ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={undo}
              disabled={history.length === 0}
              aria-label="Letzte Bewertung rückgängig"
              aria-keyshortcuts="Z Control+Z Meta+Z"
              title="Letzte Bewertung rückgängig (Z)"
            >
              <Undo2 className="size-4" />
            </Button>
          ) : null}
          {card ? (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => app.openCardEditor({ card })}
                aria-label="Karte bearbeiten"
                title="Karte bearbeiten"
              >
                <Pencil className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={suspendCard}
                aria-label="Karte aussetzen"
                title="Karte aussetzen – kommt beim Lernen und Üben nicht mehr dran"
              >
                <Pause className="size-4" />
              </Button>
            </>
          ) : null}
        </div>
        <div className="h-0.5 bg-subtle">
          <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
        </div>
      </header>
      {notice ? (
        <p className="border-b border-border bg-warning-soft px-4 py-1.5 text-center text-xs text-warning" role="status">
          {notice}
        </p>
      ) : null}

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
              {/* Karteikarte: Frage über dem roten Kopfstrich, darunter Antwortfeld (leer liniert bis zum Aufdecken) */}
              <div
                className="index-card"
                data-testid="study-card"
                onContextMenu={(e) =>
                  openContextMenu(
                    e,
                    <>
                      <MenuItem icon={<Pencil />} onSelect={() => app.openCardEditor({ card })}>
                        Karte bearbeiten …
                      </MenuItem>
                      <MenuItem icon={<Pause />} onSelect={suspendCard}>
                        Karte aussetzen
                      </MenuItem>
                      {revealed && note ? (
                        <MenuItem icon={<FileText />} onSelect={() => app.go({ kind: 'note', id: note.id })}>
                          Zur Notiz
                        </MenuItem>
                      ) : null}
                    </>,
                    { text: true, copy: true },
                  )
                }
              >
                <div className="px-5 pt-4 pb-5 sm:px-7 sm:pt-5">
                  <div className="mb-2 flex min-h-5 flex-wrap items-center gap-2 text-xs text-faint">
                    {current.kind === 'new' ? <span className="rounded-full bg-subtle px-2 py-0.5 font-medium text-muted">Neu</span> : null}
                    {card.type === 'reversed' ? <span>{side === 1 ? 'Rückseite → Vorderseite' : 'Vorderseite → Rückseite'}</span> : null}
                    {isCloze && clozeCount(card.front) > 1 ? (
                      <span>
                        Lücke {side + 1} von {clozeCount(card.front)}
                      </span>
                    ) : null}
                    {occlusion && occlusion.masks.length > 1 ? (
                      <span>
                        Fläche {side + 1} von {occlusion.masks.length}
                      </span>
                    ) : null}
                    {isMc ? <span>{singleChoice ? 'Eine Antwort ist richtig' : 'Mehrere Antworten können richtig sein'}</span> : null}
                    {isProblemCard(card, live.states) ? (
                      <span className="inline-flex items-center gap-1 text-warning" title={`Mindestens ${LEECH_LAPSES}-mal vergessen`}>
                        <AlertTriangle className="size-3.5" /> Problemkarte
                      </span>
                    ) : null}
                  </div>
                  <CardMarkdown text={question} className="study-question" />
                  {occlusion ? (
                    <div className="mt-4">
                      <OcclusionImage occlusion={occlusion} side={side} revealed={revealed} alt={card.front.trim()} />
                    </div>
                  ) : null}
                </div>
                <div className="index-card-rule" />
                <div className={cn('px-5 py-5 text-[1.0625rem] sm:px-7 sm:py-6', !isMc && !revealed && 'index-card-lines min-h-36')}>

                  {isMc ? (
                    <ul className="space-y-2" role={singleChoice ? 'radiogroup' : 'group'} aria-label="Antworten">
                      {answer.order.map((optIndex, pos) => {
                        const option = card.options[optIndex]
                        if (!option) return null
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
                        // Ergebnis nach „Prüfen“ auch als Text – Farbe und Symbol allein erreichen nicht jeden
                        const result =
                          state === 'right'
                            ? 'richtig'
                            : state === 'wrong'
                              ? 'falsch gewählt'
                              : state === 'missed'
                                ? 'richtige Antwort nicht gewählt'
                                : null
                        return (
                          // role="none": Die Liste ist hier eine (Radio-)Gruppe, die Einträge sind nur Hüllen der Antworten
                          <li key={optIndex} role="none">
                            <button
                              type="button"
                              role={singleChoice ? 'radio' : 'checkbox'}
                              aria-checked={selected}
                              disabled={answer.checked}
                              // Klick nimmt keinen Fokus – Enter prüft danach die Auswahl, statt die Antwort umzuschalten
                              onMouseDown={(e) => e.preventDefault()}
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
                                  // Je Zustand genau eine Text- und Rahmenfarbe – sonst entscheidet die CSS-Reihenfolge
                                  state === 'idle' && 'border-border-strong text-muted',
                                  state === 'selected' && 'border-accent bg-accent text-on-accent',
                                  state === 'right' && 'border-success bg-success text-bg',
                                  state === 'wrong' && 'border-danger bg-danger text-bg',
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
                              {result ? <span className="sr-only">, {result}</span> : null}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  ) : null}

                  {typing && !revealed ? (
                    <Input
                      value={answer.typed}
                      onChange={(e) => setAnswer((a) => ({ ...a, typed: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
                        e.preventDefault()
                        reveal()
                      }}
                      placeholder="Antwort eintippen …"
                      aria-label="Deine Antwort"
                      autoFocus
                      autoComplete="off"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      data-testid="typed-answer"
                    />
                  ) : null}

                  {/* Die Live-Region steht schon vor dem Aufdecken – nur dann wird die eingefügte Antwort vorgelesen */}
                  <div aria-live="polite">
                    {revealed ? (
                      <div className={cn(isMc && 'mt-5 border-t border-border pt-5')} data-testid="study-answer">
                        {answer.result ? <TypedDiff result={answer.result} /> : null}
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
                            className="mt-4 inline-flex max-w-full items-center gap-1.5 text-left text-sm text-muted hover:text-fg"
                          >
                            <FileText className="size-4 shrink-0" /> <span className="min-w-0 break-words">{note.title}</span>
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div ref={bottomBar} className="pb-safe border-t border-border bg-bg">
            <div className="mx-auto flex w-full max-w-2xl gap-2 px-4 py-3">
              {isMc && !answer.checked ? (
                <Button variant="primary" size="lg" className="flex-1" onClick={check} disabled={answer.selected.size === 0}>
                  Prüfen
                </Button>
              ) : !revealed ? (
                <Button variant="primary" size="lg" className="flex-1" onClick={reveal} data-testid="reveal">
                  {typing && answer.typed.trim() ? 'Prüfen' : 'Antwort zeigen'}
                </Button>
              ) : mode === 'learn' && intervals ? (
                isMc && correct === false ? (
                  <RatingButton rating={1} label="Weiter" hint={formatInterval(intervals[1])} onClick={rate} wide />
                ) : (
                  RATINGS.filter((r) => !(isMc && r.rating === 1)).map((r) => (
                    <RatingButton
                      key={r.rating}
                      rating={r.rating}
                      label={r.label}
                      hint={formatInterval(intervals[r.rating])}
                      onClick={rate}
                      preferred={answer.result ? r.rating === (typedWrong ? 1 : 3) : false}
                    />
                  ))
                )
              ) : isMc ? (
                <Button variant="primary" size="lg" className="flex-1" onClick={() => practiceAnswer(!!correct)}>
                  Weiter
                </Button>
              ) : (
                <>
                  {/* Farbe nur am Symbol: text-* im className kollidiert mit der Textfarbe der Button-Variante */}
                  <Button size="lg" className={cn('flex-1', answer.result && typedWrong && PREFERRED)} onClick={() => practiceAnswer(false)}>
                    <X className="size-4 text-danger" /> Nicht gewusst
                  </Button>
                  <Button size="lg" className={cn('flex-1', answer.result && !typedWrong && PREFERRED)} onClick={() => practiceAnswer(true)}>
                    <Check className="size-4 text-success" /> Gewusst
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

/**
 * Vorausgewählte Bewertung nach einer eingetippten Antwort (Leertaste/Enter wählt sie). border-accent! – cn führt
 * Klassen nicht zusammen, ohne ! gewinnt border-border der Knöpfe.
 */
const PREFERRED = 'border-accent! ring-3 ring-accent/20'

/** Eingetippte Antwort mit markierten Unterschieden: durchgestrichen = zu viel, unterstrichen = fehlt */
function TypedDiff({ result }: { result: TypedResult }) {
  return (
    <div className="mb-4 rounded-xl border border-border bg-subtle/50 px-3.5 py-3" data-testid="typed-result">
      <p className={cn('mb-1 flex items-center gap-2 text-sm font-semibold', result.correct ? 'text-success' : 'text-danger')}>
        {result.correct ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
        {result.correct ? 'Richtig eingetippt' : 'Nicht ganz – Unterschiede sind markiert'}
      </p>
      <p className="break-words">
        {result.parts.map((part, i) =>
          part.kind === 'extra' ? (
            <del key={i} title="Zu viel oder falsch" className="rounded-sm bg-danger-soft text-danger decoration-2">
              {part.text}
            </del>
          ) : part.kind === 'missing' ? (
            <ins key={i} title="Fehlt" className="rounded-sm bg-success-soft text-success underline decoration-2 underline-offset-2">
              {part.text}
            </ins>
          ) : (
            <span key={i}>{part.text}</span>
          ),
        )}
      </p>
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
  preferred,
}: {
  rating: Rating
  label: string
  hint: string
  onClick: (r: Rating) => void
  wide?: boolean
  preferred?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(rating)}
      className={cn(
        'flex h-14 min-w-0 flex-1 flex-col items-center justify-center rounded-xl border border-border bg-elevated px-1 transition-colors hover:bg-hover active:scale-[0.98]',
        wide && 'flex-1',
        preferred && PREFERRED,
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
        <Dumbbell className="size-10 stroke-[1.5] text-accent-text" />
        <div>
          <h2 className="text-2xl font-bold">{session.total === 0 ? 'Keine Karten' : 'Übung beendet'}</h2>
          {session.total > 0 ? (
            <p className="mt-1 text-muted">
              Beim ersten Versuch richtig: <strong className="text-fg">{session.correctFirstTry}</strong> von {session.total} ({pct} %)
            </p>
          ) : null}
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
  const summary = [
    nothingToDo
      ? cards.length === 0
        ? 'Hier gibt es noch keine Karten.'
        : ''
      : `Du hast ${cardsSeen} ${cardsSeen === 1 ? 'Karte' : 'Karten'} gelernt (${reviewed} ${reviewed === 1 ? 'Antwort' : 'Antworten'}).`,
    dueTomorrow > 0 ? `Morgen ${dueTomorrow === 1 ? 'ist 1 Karte' : `sind ${dueTomorrow} Karten`} fällig.` : '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center" data-testid="study-done">
      <CheckCircle2 className="size-10 stroke-[1.5] text-success" />
      <div className="max-w-md">
        <h2 className="text-2xl font-bold">{nothingToDo ? 'Für heute ist alles gelernt' : 'Geschafft!'}</h2>
        {summary ? <p className="mt-1 text-muted">{summary}</p> : null}
        {newLeft > 0 ? (
          <p className="mt-2 text-sm text-faint">
            Noch {newLeft} neue {newLeft === 1 ? 'Karte' : 'Karten'} – das Tageslimit lässt sich im Stapel einstellen.
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
