'use client'
// Probeklausur mit KI: Claude stellt aus den Karten einer Klausur bzw. eines Stapels und den Notizen dazu Aufgaben mit
// Punkten zusammen. Antworten werden getippt oder als Foto angehängt, nach der Abgabe korrigiert Claude sie mit Punkten
// und Hinweisen. Der Stand liegt auf dem Gerät (übersteht Neuladen), das Ergebnis lässt sich als Notiz speichern.
import { useEffect, useRef, useState } from 'react'
import { Camera, Clock, FilePlus, Loader2, RotateCcw, X } from 'lucide-react'
import { useApp } from '@/features/workspace/client/context'
import type { MockExamScope, View } from '@/features/workspace/client/nav'
import { useFlashcards, type Flashcards } from '@/features/flashcards/client/flashcards'
import { useEvents } from '@/features/calendar/client/calendar'
import { CardMarkdown } from '@/features/flashcards/components/CardMarkdown'
import { localDate, longDate } from '@/features/calendar/dates'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { ConfirmModal } from '@/shared/ui/modal'
import { ErrorText, useToast } from '@/shared/ui/toast'
import { cn } from '@/shared/ui/cn'
import { useReservedSpace } from '@/shared/ui/reserved-space'
import { useNow } from '@/shared/client/now'
import { errorMessage } from '@/shared/client/api'
import { sanitizeName } from '@/shared/lib/names'
import { generateQuestions, gradeAnswers, useAiSettings } from '../client/ai'
import { loadMockExam, saveMockExam } from '../client/mock-exam'
import { photoForAi } from '../client/photo'
import { MAX_AI_IMAGES, MAX_AI_TASK_PHOTOS, MAX_AI_WISHES } from '../limits'
import { examMarkdown, examPoints, isAnswered, type ExamAnswer, type MockExam } from '../mock-exam'
import { modelLabel } from '../models'
import type { AiImage } from '../types'
import { AiGradeNote } from './AiGradeNote'
import { AiSetupHint } from './AiSetupHint'
import { AnswerField } from './AnswerField'

/** Wählbarer Umfang (Aufgaben) */
const SIZES = [5, 10, 15] as const

type Target = { title: string; deckIds: string[]; deckNames: string[]; cards: number; back: View }

function resolveTarget(data: Flashcards, scope: MockExamScope): Target | null {
  const [kind, id] = scope.split(':') as ['exam' | 'deck', string]
  const decks = kind === 'exam' ? data.decks.filter((d) => d.exams?.some((e) => e.id === id)) : data.decks.filter((d) => d.id === id)
  if (!decks.length) return null
  const title = kind === 'exam' ? (decks[0].exams?.find((e) => e.id === id)?.title ?? decks[0].name) : decks[0].name
  const deckIds = decks.map((d) => d.id)
  return {
    title,
    deckIds,
    deckNames: decks.map((d) => d.name),
    cards: data.cards.filter((c) => deckIds.includes(c.deckId)).length,
    back: kind === 'exam' ? { kind: 'home' } : { kind: 'deck', id },
  }
}

const photoUrl = (p: AiImage) => `data:${p.mediaType};base64,${p.data}`

export function MockExamView({ scope }: { scope: MockExamScope }) {
  const app = useApp()
  const toast = useToast()
  const flashcards = useFlashcards()
  // Welche Stapel zu einer Klausur gehören, steht im Kalender
  const events = useEvents()
  const { data: settings } = useAiSettings()
  const data = flashcards.data
  const target = data ? resolveTarget(data, scope) : null
  // Eine angefangene Probeklausur – nur die zu diesem Bereich gilt hier, eine andere würde beim Start ersetzt
  const [stored] = useState(loadMockExam)
  const [exam, setExamState] = useState<MockExam | null>(() => (stored?.scope === scope ? stored : null))
  const [photosSaved, setPhotosSaved] = useState(true)
  const [busy, setBusy] = useState<'generate' | 'grade' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const running = useRef<AbortController | null>(null)
  useEffect(() => () => running.current?.abort(), [])

  const setExam = (next: MockExam | null) => {
    setExamState(next)
    setPhotosSaved(saveMockExam(next))
  }
  const close = () => app.go(target?.back ?? { kind: 'home' }, { replace: true })

  async function start(count: number, wishes: string) {
    if (!target) return
    running.current?.abort()
    const controller = new AbortController()
    running.current = controller
    setBusy('generate')
    setError(null)
    try {
      const r = await generateQuestions(
        { source: { kind: 'decks', title: target.title, deckIds: target.deckIds }, count, wishes: wishes.trim() || undefined },
        controller.signal,
      )
      setExam({
        scope,
        title: target.title,
        deckIds: target.deckIds,
        questions: r.questions,
        answers: r.questions.map(() => ({ text: '', photos: [] })),
        startedAt: Date.now(),
        submittedAt: null,
        results: null,
        truncated: r.truncated,
      })
    } catch (err) {
      if (!controller.signal.aborted) setError(errorMessage(err))
    } finally {
      if (running.current === controller) setBusy(null)
    }
  }

  async function submit() {
    if (!exam) return
    running.current?.abort()
    const controller = new AbortController()
    running.current = controller
    setBusy('grade')
    setError(null)
    try {
      const results = await gradeAnswers(
        {
          title: exam.title,
          items: exam.questions.map((q, i) => ({
            question: q.question,
            expected: q.answer,
            answer: exam.answers[i]?.text ?? '',
            images: exam.answers[i]?.photos.length ? exam.answers[i].photos : undefined,
            points: q.points,
          })),
        },
        controller.signal,
      )
      setExam({ ...exam, results, submittedAt: Date.now() })
      window.scrollTo?.(0, 0)
    } catch (err) {
      if (!controller.signal.aborted) setError(errorMessage(err))
    } finally {
      if (running.current === controller) setBusy(null)
    }
  }

  async function saveAsNote() {
    if (!exam) return
    const date = localDate(new Date(exam.submittedAt ?? Date.now()))
    try {
      await app.createNote({
        title: sanitizeName(`Probeklausur ${exam.title} ${date}`),
        folderId: null,
        content: examMarkdown(exam, longDate(date)),
        format: 'markdown',
      })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const title = exam?.title ?? target?.title ?? 'Probeklausur'
  const points = exam ? examPoints(exam) : null
  const subtitle = !exam
    ? 'Probeklausur mit KI'
    : exam.results
      ? 'Probeklausur – ausgewertet'
      : `Probeklausur · ${exam.questions.length} Aufgaben · ${points?.max} Punkte`

  return (
    <div className="flex h-full flex-col" data-testid="mock-exam">
      <header className="pt-safe border-b border-border">
        <div className="flex h-12 items-center gap-2 px-2 sm:px-3">
          <Button variant="ghost" size="icon" onClick={close} aria-label="Probeklausur schließen" title="Schließen – der Stand bleibt erhalten">
            <X className="size-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{title}</p>
            <p className="truncate text-xs text-muted">{subtitle}</p>
          </div>
          {exam && !exam.results ? <Elapsed since={exam.startedAt} suggested={points?.max ?? 0} /> : null}
        </div>
      </header>

      {!settings || (!exam && (flashcards.isLoading || events.isLoading)) ? (
        <Centered>
          <Loader2 className="size-6 animate-spin" />
        </Centered>
      ) : !settings.configured ? (
        <Centered>
          <AiSetupHint what="Probeklausuren von Claude stellen und korrigieren lassen" />
          <Button onClick={close}>Zurück</Button>
        </Centered>
      ) : busy === 'generate' ? (
        <Centered>
          <Loader2 className="size-6 animate-spin" />
          <p>Claude stellt die Probeklausur zusammen – das kann eine Minute dauern …</p>
          <Button
            onClick={() => {
              running.current?.abort()
              setBusy(null)
            }}
          >
            Abbrechen
          </Button>
        </Centered>
      ) : !exam ? (
        target ? (
          <Setup
            target={target}
            replaces={stored && stored.scope !== scope && !stored.results ? stored.title : null}
            model={modelLabel(settings.model)}
            error={error}
            onStart={(count, wishes) => void start(count, wishes)}
          />
        ) : (
          <Centered>
            <p>
              {data
                ? 'Diese Klausur bzw. diesen Stapel gibt es nicht (mehr) – oder es sind keine Stapel damit verknüpft.'
                : `Die Karteikarten konnten nicht geladen werden. ${errorMessage(flashcards.error)}`}
            </p>
            <Button onClick={close}>Zurück</Button>
          </Centered>
        )
      ) : exam.results ? (
        <Results
          exam={exam}
          onSave={() => void saveAsNote()}
          onRestart={() => setExam(null)}
          onClose={close}
        />
      ) : (
        <Writing
          exam={exam}
          photosSaved={photosSaved}
          grading={busy === 'grade'}
          error={error}
          onAnswer={(i, answer) => setExam({ ...exam, answers: exam.answers.map((a, j) => (j === i ? answer : a)) })}
          onSubmit={() => void submit()}
          onDiscard={() => setExam(null)}
        />
      )}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-muted">{children}</div>
}

/** Bisherige Bearbeitungszeit neben der vorgeschlagenen (etwa eine Minute je Punkt) */
function Elapsed({ since, suggested }: { since: number; suggested: number }) {
  const now = useNow(30_000)
  const minutes = Math.max(0, Math.floor((now - since) / 60_000))
  return (
    <span className={cn('flex items-center gap-1.5 pr-2 text-sm tabular-nums', minutes > suggested ? 'text-warning' : 'text-muted')} title="Bearbeitungszeit">
      <Clock className="size-4" /> {minutes} / {suggested} Min.
    </span>
  )
}

function Setup({
  target,
  replaces,
  model,
  error,
  onStart,
}: {
  target: Target
  /** Titel einer angefangenen Probeklausur zu etwas anderem, die der Start ersetzt */
  replaces: string | null
  model: string
  error: string | null
  onStart: (count: number, wishes: string) => void
}) {
  const [count, setCount] = useState<number>(10)
  const [wishes, setWishes] = useState('')
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <form
        className="mx-auto w-full max-w-xl space-y-5 px-5 py-8"
        onSubmit={(e) => {
          e.preventDefault()
          onStart(count, wishes)
        }}
      >
        <div>
          <h1 className="text-2xl font-bold">Probeklausur</h1>
          <p className="mt-2 text-muted">
            Claude stellt aus {target.cards === 1 ? 'der Karte' : `den ${target.cards} Karten`} von{' '}
            <strong className="text-fg">{target.deckNames.join(', ')}</strong> und den Notizen, aus denen sie stammen, eine Klausur
            zusammen – mit Punkten, Musterlösungen und Korrektur. Antworten kannst du tippen oder als Foto deiner handschriftlichen
            Lösung anhängen.
          </p>
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Umfang</legend>
          <div className="flex gap-1.5" role="radiogroup" aria-label="Umfang">
            {SIZES.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={count === n}
                onClick={() => setCount(n)}
                className={cn(
                  'h-9 flex-1 rounded-full border px-3 text-sm transition-colors',
                  count === n ? 'border-accent bg-accent-soft font-medium text-accent-text' : 'border-border text-muted hover:bg-hover hover:text-fg',
                )}
              >
                {n} Aufgaben
              </button>
            ))}
          </div>
        </fieldset>
        <Input
          value={wishes}
          onChange={(e) => setWishes(e.target.value)}
          maxLength={MAX_AI_WISHES}
          placeholder="Wünsche, z. B. „mehr Rechenaufgaben“ oder „nur Kapitel 3“"
          aria-label="Wünsche an Claude (optional)"
        />
        {replaces ? <p className="text-sm text-warning">Die angefangene Probeklausur „{replaces}“ wird dabei verworfen.</p> : null}
        <ErrorText>{error}</ErrorText>
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={target.cards === 0} data-testid="mock-exam-start">
          Probeklausur erstellen
        </Button>
        <p className="text-xs text-muted">
          {target.cards === 0
            ? 'In den Stapeln gibt es noch keine Karten.'
            : `Karten und Notizen gehen an Anthropic (${model}), bei der Korrektur auch deine Antworten und Fotos.`}
        </p>
      </form>
    </div>
  )
}

function Writing({
  exam,
  photosSaved,
  grading,
  error,
  onAnswer,
  onSubmit,
  onDiscard,
}: {
  exam: MockExam
  photosSaved: boolean
  grading: boolean
  error: string | null
  onAnswer: (index: number, answer: ExamAnswer) => void
  onSubmit: () => void
  onDiscard: () => void
}) {
  const [confirm, setConfirm] = useState<'submit' | 'discard' | null>(null)
  const bottomBar = useReservedSpace<HTMLDivElement>('--bottom-bar-height')
  const open = exam.questions.filter((_, i) => !isAnswered(exam.answers[i])).length
  const photoCount = exam.answers.reduce((n, a) => n + a.photos.length, 0)
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6">
          {exam.truncated ? (
            <p className="rounded-xl bg-warning-soft px-4 py-3 text-sm">
              Die Unterlagen waren sehr umfangreich – Claude hat nur einen Teil davon gesehen.
            </p>
          ) : null}
          {!photosSaved ? (
            <p className="rounded-xl bg-warning-soft px-4 py-3 text-sm" role="status">
              Die Fotos passen nicht in den Speicher des Browsers. Lade die Seite nicht neu, bevor du abgegeben hast.
            </p>
          ) : null}
          {exam.questions.map((q, i) => (
            <section key={i} className="rounded-2xl border border-border bg-elevated p-4 sm:p-5" data-testid="mock-exam-task">
              <TaskHead index={i} points={q.points} topic={q.topic} />
              <CardMarkdown text={q.question} className="mb-3" />
              <AnswerField
                value={exam.answers[i]?.text ?? ''}
                onChange={(e) => onAnswer(i, { ...exam.answers[i], text: e.target.value })}
                placeholder="Deine Antwort …"
                aria-label={`Antwort auf Aufgabe ${i + 1}`}
                disabled={grading}
              />
              <PhotoStrip
                photos={exam.answers[i]?.photos ?? []}
                canAdd={!grading && (exam.answers[i]?.photos.length ?? 0) < MAX_AI_TASK_PHOTOS && photoCount < MAX_AI_IMAGES}
                onChange={(photos) => onAnswer(i, { ...exam.answers[i], photos })}
                label={`Aufgabe ${i + 1}`}
              />
            </section>
          ))}
        </div>
      </div>
      <div ref={bottomBar} className="pb-safe border-t border-border bg-bg">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 px-4 py-3">
          <Button variant="ghost" onClick={() => setConfirm('discard')} disabled={grading}>
            <RotateCcw className="size-4" /> Neu beginnen
          </Button>
          <div className="min-w-0 flex-1">
            <ErrorText>{error}</ErrorText>
          </div>
          <Button variant="primary" size="lg" onClick={() => (open ? setConfirm('submit') : onSubmit())} loading={grading} data-testid="mock-exam-submit">
            {grading ? 'Claude korrigiert …' : 'Abgeben'}
          </Button>
        </div>
      </div>
      <ConfirmModal
        open={confirm === 'submit'}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null)
          onSubmit()
        }}
        title="Abgeben?"
        description={open === 1 ? 'Eine Aufgabe ist noch leer – sie zählt 0 Punkte.' : `${open} Aufgaben sind noch leer – sie zählen 0 Punkte.`}
        confirmLabel="Abgeben"
      />
      <ConfirmModal
        open={confirm === 'discard'}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null)
          onDiscard()
        }}
        title="Probeklausur verwerfen?"
        description="Aufgaben und Antworten gehen verloren. Danach kannst du eine neue erstellen."
        confirmLabel="Verwerfen"
        danger
      />
    </>
  )
}

function TaskHead({ index, points, topic, result }: { index: number; points: number; topic: string; result?: number }) {
  return (
    <p className="mb-2 flex flex-wrap items-baseline gap-x-2 text-sm">
      <span className="font-semibold">Aufgabe {index + 1}</span>
      <span className="text-muted tabular-nums">
        {result !== undefined ? `${result.toLocaleString('de-DE')} / ` : ''}
        {points} {points === 1 ? 'Punkt' : 'Punkte'}
      </span>
      {topic ? <span className="min-w-0 truncate text-xs text-faint">{topic}</span> : null}
    </p>
  )
}

/** Fotos einer Antwort: Vorschau, entfernen und – am Handy direkt mit der Kamera – hinzufügen */
function PhotoStrip({
  photos,
  canAdd,
  onChange,
  label,
}: {
  photos: AiImage[]
  canAdd?: boolean
  onChange?: (photos: AiImage[]) => void
  label: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add(files: FileList | null) {
    if (!files?.length || !onChange) return
    setBusy(true)
    setError(null)
    const next = [...photos]
    try {
      for (const file of Array.from(files).slice(0, MAX_AI_TASK_PHOTOS - photos.length)) next.push(await photoForAi(file))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
      onChange(next)
      if (input.current) input.current.value = ''
    }
  }

  if (!photos.length && !onChange) return null
  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        {photos.map((p, i) => (
          <span key={i} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- Vorschau eines Fotos aus dem Speicher des Browsers */}
            <img src={photoUrl(p)} alt={`Foto ${i + 1} zu ${label}`} className="h-20 rounded-lg border border-border object-cover" />
            {onChange ? (
              <button
                type="button"
                onClick={() => onChange(photos.filter((_, j) => j !== i))}
                className="absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full border border-border bg-elevated text-muted shadow-sm hover:text-fg"
                aria-label={`Foto ${i + 1} entfernen`}
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </span>
        ))}
        {onChange ? (
          <>
            <input
              ref={input}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              hidden
              onChange={(e) => void add(e.target.files)}
              data-testid="mock-exam-photo-input"
            />
            <Button size="sm" variant="ghost" onClick={() => input.current?.click()} disabled={!canAdd || busy} loading={busy}>
              <Camera className="size-4" /> Foto
            </Button>
          </>
        ) : null}
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  )
}

function Results({ exam, onSave, onRestart, onClose }: { exam: MockExam; onSave: () => void; onRestart: () => void; onClose: () => void }) {
  const { points, max, percent } = examPoints(exam)
  const bottomBar = useReservedSpace<HTMLDivElement>('--bottom-bar-height')
  const minutes = exam.submittedAt ? Math.max(1, Math.round((exam.submittedAt - exam.startedAt) / 60_000)) : null
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6">
          <section className="rounded-2xl border border-border bg-elevated p-5 text-center" data-testid="mock-exam-score">
            <p className="text-3xl font-bold tabular-nums">
              {points.toLocaleString('de-DE')} <span className="text-lg font-medium text-muted">von {max} Punkten</span>
            </p>
            <div className="mx-auto mt-3 h-2 max-w-sm overflow-hidden rounded-full bg-subtle">
              <div
                className={cn('h-full rounded-full', percent >= 50 ? 'bg-success' : 'bg-warning')}
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-muted">
              {percent} %{minutes ? ` · ${minutes} Min. Bearbeitungszeit` : ''}
            </p>
          </section>
          {exam.questions.map((q, i) => {
            const result = exam.results?.[i]
            const answer = exam.answers[i]
            return (
              <section key={i} className="rounded-2xl border border-border bg-elevated p-4 sm:p-5" data-testid="mock-exam-result">
                <TaskHead index={i} points={q.points} topic={q.topic} result={result?.points} />
                <CardMarkdown text={q.question} className="mb-3" />
                <p className="mb-1 text-xs font-medium text-faint">Deine Antwort</p>
                {answer?.text.trim() ? (
                  <p className="text-[15px] break-words whitespace-pre-wrap">{answer.text}</p>
                ) : !answer?.photos.length ? (
                  <p className="text-sm text-faint italic">Keine Antwort</p>
                ) : null}
                <PhotoStrip photos={answer?.photos ?? []} label={`Aufgabe ${i + 1}`} />
                {result ? <AiGradeNote check={{ status: 'done', result }} max={q.points} className="mt-3" /> : null}
                <details className="mt-3 rounded-xl border border-border px-3.5 py-2.5">
                  <summary className="cursor-pointer text-sm font-medium">Musterlösung</summary>
                  <CardMarkdown text={q.answer} className="mt-2" />
                </details>
              </section>
            )
          })}
        </div>
      </div>
      <div ref={bottomBar} className="pb-safe border-t border-border bg-bg">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap gap-2 px-4 py-3">
          <Button onClick={onSave}>
            <FilePlus className="size-4" /> Als Notiz speichern
          </Button>
          <Button onClick={onRestart}>
            <RotateCcw className="size-4" /> Neue Probeklausur
          </Button>
          <Button variant="primary" className="ml-auto" onClick={onClose}>
            Fertig
          </Button>
        </div>
      </div>
    </>
  )
}
