'use client'
// Aufgaben wiederholen: eine nach der anderen bearbeiten, die Lösung aufdecken und selbst einschätzen
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, CheckCircle2, CircleHelp, Loader2, X } from 'lucide-react'
import { useApp } from '@/features/workspace/client/context'
import { CardMarkdown } from '@/features/flashcards/components/CardMarkdown'
import { localDate } from '@/features/calendar/dates'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { useToast } from '@/shared/ui/toast'
import { useReservedSpace } from '@/shared/ui/reserved-space'
import { errorMessage } from '@/shared/client/api'
import { useNow } from '@/shared/client/now'
import { useCoursework, useCourseworkMutations } from '../client/coursework'
import { reviewOrder, TASK_INTERVALS, TASK_RESULT_LABELS } from '../tasks'
import type { CourseTask, TaskResult } from '../types'

type Session = { title: string; tasks: CourseTask[] }

export function TaskReview({ courseId }: { courseId: string }) {
  const app = useApp()
  const { data, isLoading } = useCoursework()
  const today = localDate(new Date(useNow()))
  // Reihenfolge einmalig beim Öffnen – die Bewertungen ändern den Stand, nicht die laufende Reihenfolge.
  // Ist nichts offen, kommen alle Aufgaben noch einmal dran.
  const [session, setSession] = useState<Session | null>(null)
  const course = data?.courses.find((c) => c.id === courseId)
  if (!session && data && course) {
    const tasks = data.tasks.filter((t) => t.courseId === courseId)
    const open = reviewOrder(tasks, today)
    setSession({ title: course.name, tasks: open.length > 0 ? open : [...tasks].sort((a, b) => a.createdAt - b.createdAt) })
  }

  const back = () => app.go({ kind: 'tasks', course: courseId }, { replace: true })
  if (session && session.tasks.length > 0) return <ReviewSession session={session} onClose={back} />
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-muted">
      {isLoading ? (
        <Loader2 className="size-6 animate-spin" />
      ) : (
        <>
          <p>{course ? 'In diesem Fach gibt es noch keine Aufgaben.' : 'Dieses Fach gibt es nicht (mehr).'}</p>
          <Button onClick={course ? back : () => app.go({ kind: 'coursework' })}>Zurück</Button>
        </>
      )}
    </div>
  )
}

const RATINGS: { result: TaskResult; key: string; icon: React.ReactNode }[] = [
  { result: 'wrong', key: '1', icon: <X className="size-4 text-danger" /> },
  { result: 'unsure', key: '2', icon: <CircleHelp className="size-4 text-warning" /> },
  { result: 'solved', key: '3', icon: <Check className="size-4 text-success" /> },
]

function ReviewSession({ session, onClose }: { session: Session; onClose: () => void }) {
  const toast = useToast()
  const m = useCourseworkMutations()
  const [pos, setPos] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [results, setResults] = useState<TaskResult[]>([])
  const current = session.tasks[pos] ?? null
  const hasSolution = !!current?.solution
  const busy = m.attemptTask.isPending

  const rate = useCallback(
    async (result: TaskResult) => {
      if (!current || busy) return
      try {
        await m.attemptTask.mutateAsync({ id: current.id, result })
        setResults((r) => [...r, result])
        setPos((p) => p + 1)
        setRevealed(false)
      } catch (err) {
        toast.error(errorMessage(err))
      }
    },
    [current, busy, m.attemptTask, toast],
  )

  // Tastatur: Leertaste/Enter deckt die Lösung auf, 1 = falsch, 2 = unsicher, 3 = gelöst
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const root = rootRef.current
      if (!current || !root || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement
      if (!root.offsetParent || (t !== document.body && !root.contains(t))) return
      if (t.closest('input, textarea, select, [contenteditable="true"], dialog[open], [role="menu"]')) return
      const primary = e.key === ' ' || e.key === 'Enter'
      if (primary && t.closest('button, a')) return
      const rating = RATINGS.find((r) => r.key === e.key)
      if (hasSolution && !revealed && primary) setRevealed(true)
      else if (rating && (revealed || !hasSolution)) void rate(rating.result)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, revealed, hasSolution, rate])

  const bottomBar = useReservedSpace<HTMLDivElement>('--bottom-bar-height')
  const count = (r: TaskResult) => results.filter((x) => x === r).length

  return (
    <div ref={rootRef} className="flex h-full flex-col" data-testid="task-review">
      <header className="pt-safe border-b border-border">
        <div className="flex h-12 items-center gap-2 px-2 sm:px-3">
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Wiederholung beenden" title="Beenden">
            <X className="size-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">Aufgaben – {session.title}</p>
            <p className="text-xs text-muted">Bearbeiten, Lösung vergleichen, selbst einschätzen</p>
          </div>
          <span className="pr-2 text-sm text-muted tabular-nums" title="Aufgabe / Aufgaben">
            {Math.min(pos + 1, session.tasks.length)} / {session.tasks.length}
          </span>
        </div>
        <div className="h-0.5 bg-subtle">
          <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${(pos / session.tasks.length) * 100}%` }} />
        </div>
      </header>

      {!current ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 px-6 py-10 text-center" data-testid="task-review-done">
            <CheckCircle2 className="size-10 stroke-[1.5] text-success" />
            <div>
              <h2 className="text-2xl font-bold">Geschafft!</h2>
              <p className="mt-1 text-muted">
                {RATINGS.map((r) => `${count(r.result)} ${TASK_RESULT_LABELS[r.result].toLowerCase()}`)
                  .reverse()
                  .join(' · ')}
              </p>
              {count('wrong') + count('unsure') > 0 ? (
                <p className="mt-2 text-sm text-faint">
                  Falsche Aufgaben kommen in {TASK_INTERVALS.wrong} Tagen wieder, unsichere in {TASK_INTERVALS.unsure} Tagen.
                </p>
              ) : null}
            </div>
            <Button onClick={onClose}>Zu den Aufgaben</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-10">
              <div className="index-card" data-testid="task-card">
                <div className="px-5 pt-4 pb-5 sm:px-7 sm:pt-5">
                  <p className="mb-2 truncate text-xs text-faint">{current.title}</p>
                  {current.prompt ? <CardMarkdown text={current.prompt} /> : <p className="font-medium">{current.title}</p>}
                </div>
                {hasSolution ? (
                  <>
                    <div className="index-card-rule" />
                    <div className={cn('px-5 py-5 sm:px-7 sm:py-6', !revealed && 'index-card-lines min-h-24')}>
                      {revealed ? (
                        <div data-testid="task-solution">
                          <p className="mb-2 text-xs font-medium text-faint">Lösung</p>
                          <CardMarkdown text={current.solution} />
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          <div ref={bottomBar} className="pb-safe border-t border-border bg-bg">
            <div className="mx-auto flex w-full max-w-2xl gap-2 px-4 py-3">
              {hasSolution && !revealed ? (
                <Button variant="primary" size="lg" className="flex-1" onClick={() => setRevealed(true)} data-testid="task-reveal">
                  Lösung zeigen
                </Button>
              ) : (
                RATINGS.map((r) => (
                  // Farbe nur am Symbol: text-* im className kollidiert mit der Textfarbe der Button-Variante
                  <Button
                    key={r.result}
                    size="lg"
                    className="flex-1"
                    onClick={() => void rate(r.result)}
                    disabled={busy}
                    data-testid={`task-${r.result}`}
                  >
                    {r.icon} {TASK_RESULT_LABELS[r.result]}
                  </Button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
