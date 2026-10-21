'use client'
// Notiz abfragen: Überschrift für Überschrift aufdecken und selbst bewerten – ohne Einfluss auf den Wiederholungsplan
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, CheckCircle2, FileText, Layers, ListChecks, Loader2, RotateCcw, X } from 'lucide-react'
import { useApp } from '@/features/workspace/client/context'
import { useDrafts, useNote } from '@/features/notes/client/queries'
import type { NoteFormat } from '@/features/notes/types'
import { CardMarkdown } from './CardMarkdown'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { useReservedSpace } from '@/shared/ui/reserved-space'
import { errorMessage } from '@/shared/client/api'
import { makeExcerpt } from '@/shared/markdown/meta'
import { canQuiz, quizSections, type QuizSection } from '../note-quiz'

type Quiz = { title: string; markdown: string; sections: QuizSection[] }

async function toMarkdown(content: string, format: NoteFormat, title: string): Promise<string> {
  if (format === 'markdown') return content
  const { convertContent } = await import('@/features/notes/client/convert')
  return convertContent(content, format, 'markdown', title)
}

export function QuizView({ id }: { id: string }) {
  const app = useApp()
  const drafts = useDrafts()
  const draft = drafts.find((d) => d.id === id)
  const query = useNote(id, !draft?.isNew)
  // Lokaler Entwurf vor dem Stand des Servers – so gilt auch, was noch nicht synchronisiert ist
  const title = draft?.title ?? query.data?.title
  const format = draft?.format ?? query.data?.format ?? (draft?.isNew ? 'markdown' : undefined)
  const content = draft?.content ?? query.data?.content ?? (draft?.isNew ? '' : undefined)

  // Abfrage einmalig aus dem Stand beim Öffnen – spätere Änderungen an der Notiz bringen sie nicht durcheinander
  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => {
    if (quiz || title === undefined || format === undefined || content === undefined || !canQuiz(format)) return
    let cancelled = false
    toMarkdown(content, format, title).then(
      (markdown) => {
        if (!cancelled) setQuiz({ title, markdown, sections: quizSections(markdown) })
      },
      (err) => {
        if (!cancelled) setFailed(errorMessage(err))
      },
    )
    return () => {
      cancelled = true
    }
  }, [quiz, title, format, content])

  const toNote = () => app.go({ kind: 'note', id }, { replace: true })

  if (quiz && quiz.sections.length > 0) return <QuizSession noteId={id} quiz={quiz} onClose={toNote} />

  const message = quiz
    ? 'In dieser Notiz gibt es keine Überschrift mit Text darunter. Gliedere sie mit Überschriften – jede wird beim Abfragen zur Frage.'
    : format && !canQuiz(format)
      ? 'Einfacher Text hat keine Überschriften. Wandle die Notiz unter ⋮ → Format … in Markdown um, um sie abzufragen.'
      : failed
        ? `Die Notiz konnte nicht vorbereitet werden. ${failed}`
        : query.error
          ? `Die Notiz konnte nicht geladen werden. ${errorMessage(query.error)}`
          : null
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-muted">
      {message ? (
        <>
          <ListChecks className="size-10 stroke-[1.5] text-faint" />
          <p className="max-w-md">{message}</p>
          <Button onClick={toNote}>Zur Notiz</Button>
        </>
      ) : (
        <Loader2 className="size-6 animate-spin" />
      )}
    </div>
  )
}

/** Übergeordnete Überschriften und die Überschrift als Klartext („Folgen › Grenzwert“) */
const trail = (s: QuizSection) => [...s.path, s.heading].map((h) => makeExcerpt(h, 80)).join(' › ')

function QuizSession({ noteId, quiz, onClose }: { noteId: string; quiz: Quiz; onClose: () => void }) {
  const app = useApp()
  const all = useMemo(() => quiz.sections.map((_, i) => i), [quiz])
  // Reihenfolge wie in der Notiz; „Nicht gewusste wiederholen“ fragt nur diese erneut ab
  const [order, setOrder] = useState(all)
  const [pos, setPos] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [results, setResults] = useState<boolean[]>([])
  const current = pos < order.length ? quiz.sections[order[pos]] : null

  const answer = useCallback(
    (known: boolean) => {
      if (!current) return
      setResults((r) => [...r, known])
      setPos((p) => p + 1)
      setRevealed(false)
    },
    [current],
  )

  const restart = (indices: number[]) => {
    setOrder(indices)
    setPos(0)
    setResults([])
    setRevealed(false)
  }

  // Tastatur wie beim Üben: Leertaste/Enter = aufdecken bzw. gewusst, 1 = nicht gewusst, 2 = gewusst
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const root = rootRef.current
      if (!current || !root || e.metaKey || e.ctrlKey || e.altKey) return
      // Nur, wenn die Abfrage sichtbar ist und der Fokus nicht woanders liegt (z. B. im PDF daneben)
      const t = e.target as HTMLElement
      if (!root.offsetParent || (t !== document.body && !root.contains(t))) return
      if (t.closest('input, textarea, select, [contenteditable="true"], dialog[open], [role="menu"]')) return
      const primary = e.key === ' ' || e.key === 'Enter'
      if (primary && t.closest('button, a')) return
      let handled = true
      if (!revealed) {
        if (primary) setRevealed(true)
        else handled = false
      } else if (e.key === '1') answer(false)
      else if (e.key === '2' || primary) answer(true)
      else handled = false
      if (handled) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, revealed, answer])

  // Werkzeugleiste und Mini-Timer bleiben über den Knöpfen
  const bottomBar = useReservedSpace<HTMLDivElement>('--bottom-bar-height')

  const missed = order.filter((_, i) => results[i] === false)
  const knownCount = results.filter(Boolean).length

  return (
    <div ref={rootRef} className="flex h-full flex-col" data-testid="quiz">
      <header className="pt-safe border-b border-border">
        <div className="flex h-12 items-center gap-2 px-2 sm:px-3">
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Abfrage beenden" title="Beenden">
            <X className="size-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{quiz.title}</p>
            <p className="text-xs text-muted">Abfragen – ohne Einfluss auf den Lernplan</p>
          </div>
          <span className="pr-2 text-sm text-muted tabular-nums" title="Abschnitt / Abschnitte">
            {Math.min(pos + 1, order.length)} / {order.length}
          </span>
        </div>
        <div className="h-0.5 bg-subtle">
          <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${(pos / order.length) * 100}%` }} />
        </div>
      </header>

      {!current ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 px-6 py-10 text-center" data-testid="quiz-done">
            <CheckCircle2 className="size-10 stroke-[1.5] text-success" />
            <div>
              <h2 className="text-2xl font-bold">Abfrage beendet</h2>
              <p className="mt-1 text-muted">
                Gewusst: <strong className="text-fg">{knownCount}</strong> von {order.length} ({Math.round((knownCount / order.length) * 100)} %)
              </p>
            </div>
            {missed.length > 0 ? (
              <div className="w-full rounded-xl border border-border text-left">
                <p className="border-b border-border px-4 py-2 text-xs font-medium text-muted">Nicht gewusst</p>
                <ul className="divide-y divide-border text-sm" data-testid="quiz-missed">
                  {missed.map((i) => (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => app.go({ kind: 'note', id: noteId, heading: quiz.sections[i].heading })}
                        className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-hover"
                        title="In der Notiz zeigen"
                      >
                        <span className="min-w-0 flex-1 break-words">{trail(quiz.sections[i])}</span>
                        <FileText className="size-4 shrink-0 text-faint" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex flex-wrap justify-center gap-2">
              {missed.length > 0 ? (
                <>
                  <Button variant="primary" onClick={() => restart(missed)}>
                    <RotateCcw className="size-4" /> Nicht gewusste wiederholen ({missed.length})
                  </Button>
                  <Button
                    onClick={() =>
                      app.openCardsFromNote({
                        id: noteId,
                        title: quiz.title,
                        content: quiz.markdown,
                        preselect: missed.map((i) => quiz.sections[i].line),
                      })
                    }
                  >
                    <Layers className="size-4" /> Karteikarten daraus erstellen
                  </Button>
                </>
              ) : null}
              <Button onClick={() => restart(all)}>Alle nochmal</Button>
              <Button onClick={onClose}>
                <FileText className="size-4" /> Zur Notiz
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-10">
              <div className="index-card" data-testid="quiz-card">
                <div className="px-5 pt-4 pb-5 sm:px-7 sm:pt-5">
                  <p className="mb-2 min-h-5 truncate text-xs text-faint">{current.path.map((h) => makeExcerpt(h, 80)).join(' › ')}</p>
                  <CardMarkdown text={current.heading} className="study-question" />
                </div>
                <div className="index-card-rule" />
                {/* Live-Region bleibt stehen, damit die aufgedeckte Antwort vorgelesen wird */}
                <div className={cn('px-5 py-5 text-[1.0625rem] sm:px-7 sm:py-6', !revealed && 'index-card-lines min-h-36')} aria-live="polite">
                  {revealed ? (
                    <div data-testid="quiz-answer">
                      <CardMarkdown text={current.body} />
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div ref={bottomBar} className="pb-safe border-t border-border bg-bg">
            <div className="mx-auto flex w-full max-w-2xl gap-2 px-4 py-3">
              {!revealed ? (
                <Button variant="primary" size="lg" className="flex-1" onClick={() => setRevealed(true)} data-testid="quiz-reveal">
                  Aufdecken
                </Button>
              ) : (
                <>
                  {/* Farbe nur am Symbol: text-* im className kollidiert mit der Textfarbe der Button-Variante */}
                  <Button size="lg" className="flex-1" onClick={() => answer(false)}>
                    <X className="size-4 text-danger" /> Nicht gewusst
                  </Button>
                  <Button size="lg" className="flex-1" onClick={() => answer(true)}>
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
