'use client'
// Notiz mit KI abfragen: Claude stellt Verständnisfragen zur Mitschrift, beurteilt jede Antwort und zeigt die
// Musterlösung – ohne Einfluss auf den Lernplan. Am Ende lassen sich aus den Lücken Karteikarten machen.
import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, FileText, Layers, Loader2, MessageCircleQuestion, RotateCcw, X } from 'lucide-react'
import { useApp } from '@/features/workspace/client/context'
import { CardMarkdown } from '@/features/flashcards/components/CardMarkdown'
import type { QuizSection } from '@/features/flashcards/note-quiz'
import { Button } from '@/shared/ui/button'
import { useReservedSpace } from '@/shared/ui/reserved-space'
import { errorMessage } from '@/shared/client/api'
import { makeExcerpt } from '@/shared/markdown/meta'
import { generateQuestions, gradeAnswers, useAiSettings } from '../client/ai'
import { MAX_AI_NOTE_CHARS } from '../limits'
import type { QuizQuestion } from '../types'
import { AiAssistant } from './AiAssistant'
import { VERDICT_LABELS } from '../grade'
import { AiGradeNote, type GradeCheck } from './AiGradeNote'
import { AiSetupHint } from './AiSetupHint'
import { AnswerField } from './AnswerField'

/** So viele Fragen stellt Claude höchstens – bei kurzen Notizen weniger */
const TUTOR_QUESTIONS = 8

type Quiz = { title: string; markdown: string; sections: QuizSection[] }

/** `skipped`: „Weiß ich nicht“ – zählt wie falsch */
type Entry = { typed: string; check: GradeCheck | null; skipped: boolean }

const emptyEntry = (): Entry => ({ typed: '', check: null, skipped: false })

const norm = (s: string) => s.replace(/[*_`=~]/g, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('de')

export function AiTutor({ noteId, quiz, onClose }: { noteId: string; quiz: Quiz; onClose: () => void }) {
  const app = useApp()
  const { data: settings } = useAiSettings()
  const ready = settings?.configured === true
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pos, setPos] = useState(0)
  const [entries, setEntries] = useState<Entry[]>([])
  const [followUp, setFollowUp] = useState(false)
  const loading = useRef<AbortController | null>(null)
  const grading = useRef<AbortController | null>(null)

  function load() {
    loading.current?.abort()
    const controller = new AbortController()
    loading.current = controller
    setQuestions(null)
    setLoadError(null)
    setPos(0)
    setEntries([])
    generateQuestions(
      { source: { kind: 'note', noteId, title: quiz.title, content: quiz.markdown }, count: TUTOR_QUESTIONS },
      controller.signal,
    ).then(
      (r) => {
        if (controller.signal.aborted) return
        setQuestions(r.questions)
        setEntries(r.questions.map(emptyEntry))
      },
      (err) => {
        if (!controller.signal.aborted) setLoadError(errorMessage(err))
      },
    )
  }

  useEffect(() => {
    if (!ready) return
    // Erst nach dem Rendern losschicken: Im StrictMode räumt React den ersten Durchlauf sofort wieder ab
    const timer = setTimeout(load)
    return () => {
      clearTimeout(timer)
      loading.current?.abort()
      grading.current?.abort()
    }
    // Nur einmal, sobald die KI bereitsteht – „Neue Fragen“ lädt von Hand
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  const current = questions && pos < questions.length ? questions[pos] : null
  const entry = entries[pos] ?? emptyEntry()
  const answered = entry.skipped || entry.check !== null
  const update = (i: number, patch: Partial<Entry>) => setEntries((list) => list.map((e, j) => (j === i ? { ...e, ...patch } : e)))
  const sectionOf = (topic: string) => (topic ? quiz.sections.find((s) => norm(s.heading) === norm(topic)) : undefined)

  function check() {
    if (!current || !entry.typed.trim()) return
    const i = pos
    const section = sectionOf(current.topic)
    const controller = new AbortController()
    grading.current = controller
    update(i, { check: { status: 'running' } })
    gradeAnswers(
      {
        title: quiz.title,
        noteId,
        context: section ? `${section.heading}\n${section.body}` : undefined,
        items: [{ question: current.question, expected: current.answer, answer: entry.typed }],
      },
      controller.signal,
    ).then(
      ([result]) => update(i, { check: result ? { status: 'done', result } : { status: 'error', message: 'Keine Bewertung erhalten.' } }),
      (err) => {
        if (!controller.signal.aborted) update(i, { check: { status: 'error', message: errorMessage(err) } })
      },
    )
  }

  const next = () => setPos((p) => p + 1)

  // Tastatur: Enter/Leertaste nach dem Prüfen = weiter (im Antwortfeld schickt Strg/⌘+Enter ab)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const root = rootRef.current
      if (!current || !answered || !root || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement
      if (!root.offsetParent || (t !== document.body && !root.contains(t))) return
      if (t.closest('input, textarea, select, button, a, [contenteditable="true"], dialog[open], [role="menu"]')) return
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, answered])

  const bottomBar = useReservedSpace<HTMLDivElement>('--bottom-bar-height')

  const verdictOf = (e: Entry) => (e.skipped ? 'wrong' : e.check?.status === 'done' ? e.check.result.verdict : null)
  const counts = { correct: 0, partial: 0, wrong: 0 }
  for (const e of entries) {
    const v = verdictOf(e)
    if (v) counts[v]++
  }
  const missed = (questions ?? []).map((q, i) => ({ q, i })).filter(({ i }) => verdictOf(entries[i]) !== 'correct')
  const missedLines = [...new Set(missed.map(({ q }) => sectionOf(q.topic)?.line).filter((l): l is number => l !== undefined))]

  const total = questions?.length ?? 0
  return (
    <div ref={rootRef} className="flex h-full flex-col" data-testid="ai-tutor">
      <header className="pt-safe border-b border-border">
        <div className="flex h-12 items-center gap-2 px-2 sm:px-3">
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Abfrage beenden" title="Beenden">
            <X className="size-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{quiz.title}</p>
            <p className="text-xs text-muted">Mit KI abfragen – ohne Einfluss auf den Lernplan</p>
          </div>
          {total ? (
            <span className="pr-2 text-sm text-muted tabular-nums" title="Frage / Fragen">
              {Math.min(pos + 1, total)} / {total}
            </span>
          ) : null}
        </div>
        <div className="h-0.5 bg-subtle">
          <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${total ? (pos / total) * 100 : 0}%` }} />
        </div>
      </header>

      {!settings ? (
        <Centered>
          <Loader2 className="size-6 animate-spin" />
        </Centered>
      ) : !ready ? (
        <Centered>
          <AiSetupHint what="Notizen von Claude abfragen lassen" />
          <Button onClick={onClose}>Zur Notiz</Button>
        </Centered>
      ) : loadError ? (
        <Centered>
          <p className="max-w-md text-danger">{loadError}</p>
          <div className="flex gap-2">
            <Button variant="primary" onClick={load}>
              <RotateCcw className="size-4" /> Noch einmal
            </Button>
            <Button onClick={onClose}>Zur Notiz</Button>
          </div>
        </Centered>
      ) : !questions ? (
        <Centered>
          <Loader2 className="size-6 animate-spin" />
          <p>Claude liest die Notiz und stellt Fragen …</p>
          <Button onClick={onClose}>Abbrechen</Button>
        </Centered>
      ) : !current ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 px-6 py-10 text-center" data-testid="ai-tutor-done">
            <CheckCircle2 className="size-10 stroke-[1.5] text-success" />
            <div>
              <h2 className="text-2xl font-bold">Abfrage beendet</h2>
              <p className="mt-1 text-muted">
                Richtig: <strong className="text-fg">{counts.correct}</strong> · Teilweise: <strong className="text-fg">{counts.partial}</strong> ·
                Falsch: <strong className="text-fg">{counts.wrong}</strong> – von {total} Fragen
              </p>
            </div>
            {missed.length > 0 ? (
              <div className="w-full rounded-xl border border-border text-left">
                <p className="border-b border-border px-4 py-2 text-xs font-medium text-muted">Noch nicht sicher</p>
                <ul className="divide-y divide-border text-sm">
                  {missed.map(({ q, i }) => {
                    const section = sectionOf(q.topic)
                    const v = verdictOf(entries[i])
                    return (
                      <li key={i} className="flex items-center gap-2 px-4 py-2">
                        <span className="min-w-0 flex-1 break-words">{makeExcerpt(q.question, 140)}</span>
                        <span className="shrink-0 text-xs text-faint">{v ? VERDICT_LABELS[v] : 'Nicht bewertet'}</span>
                        {section ? (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => app.go({ kind: 'note', id: noteId, heading: section.heading })}
                            aria-label="In der Notiz zeigen"
                            title="In der Notiz zeigen"
                          >
                            <FileText className="size-4" />
                          </Button>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : null}
            <div className="flex flex-wrap justify-center gap-2">
              {missedLines.length > 0 ? (
                <Button
                  variant="primary"
                  onClick={() => app.openCardsFromNote({ id: noteId, title: quiz.title, content: quiz.markdown, preselect: missedLines })}
                >
                  <Layers className="size-4" /> Karteikarten aus den Lücken
                </Button>
              ) : null}
              <Button onClick={load}>
                <RotateCcw className="size-4" /> Neue Fragen
              </Button>
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
              <div className="index-card" data-testid="ai-tutor-card">
                <div className="px-5 pt-4 pb-5 sm:px-7 sm:pt-5">
                  <p className="mb-2 min-h-5 truncate text-xs text-faint">{current.topic}</p>
                  <CardMarkdown text={current.question} className="study-question" />
                </div>
                <div className="index-card-rule" />
                <div className="space-y-4 px-5 py-5 sm:px-7 sm:py-6" aria-live="polite">
                  {answered ? (
                    <>
                      {entry.typed.trim() ? (
                        <div>
                          <p className="mb-1 text-xs font-medium text-faint">Deine Antwort</p>
                          <p className="text-[15px] break-words whitespace-pre-wrap">{entry.typed}</p>
                        </div>
                      ) : null}
                      {entry.check ? <AiGradeNote check={entry.check} /> : null}
                      <div data-testid="ai-tutor-solution">
                        <p className="mb-1 text-xs font-medium text-faint">Musterlösung</p>
                        <CardMarkdown text={current.answer} />
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                        {sectionOf(current.topic) ? (
                          <button
                            type="button"
                            onClick={() => app.go({ kind: 'note', id: noteId, heading: sectionOf(current.topic)?.heading })}
                            className="inline-flex items-center gap-1.5 text-muted hover:text-fg"
                          >
                            <FileText className="size-4" /> In der Notiz zeigen
                          </button>
                        ) : null}
                        <button type="button" onClick={() => setFollowUp(true)} className="inline-flex items-center gap-1.5 text-muted hover:text-fg">
                          <MessageCircleQuestion className="size-4" /> Nachfragen …
                        </button>
                      </div>
                    </>
                  ) : (
                    <AnswerField
                      key={pos}
                      value={entry.typed}
                      onChange={(e) => update(pos, { typed: e.target.value })}
                      onSubmit={check}
                      placeholder="Deine Antwort … (Strg+Enter prüft)"
                      aria-label="Deine Antwort"
                      autoFocus
                      data-testid="ai-tutor-answer"
                    />
                  )}
                </div>
              </div>
            </div>
          </div>

          <div ref={bottomBar} className="pb-safe border-t border-border bg-bg">
            <div className="mx-auto flex w-full max-w-2xl gap-2 px-4 py-3">
              {!answered ? (
                <>
                  <Button size="lg" className="flex-1" onClick={() => update(pos, { skipped: true })}>
                    Weiß ich nicht
                  </Button>
                  <Button variant="primary" size="lg" className="flex-1" onClick={check} disabled={!entry.typed.trim()} data-testid="ai-tutor-check">
                    Prüfen
                  </Button>
                </>
              ) : (
                <>
                  {entry.check?.status === 'error' ? (
                    <Button size="lg" className="flex-1" onClick={check}>
                      <RotateCcw className="size-4" /> Noch einmal prüfen
                    </Button>
                  ) : null}
                  <Button variant="primary" size="lg" className="flex-1" onClick={next} autoFocus data-testid="ai-tutor-next">
                    {pos + 1 < total ? 'Weiter' : 'Auswertung'}
                  </Button>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {followUp && current ? (
        <AiAssistant
          title={quiz.title}
          noteId={noteId}
          scopes={[
            {
              label: 'Frage',
              text: [
                `Frage:\n${current.question}`,
                `Musterlösung:\n${current.answer}`,
                entry.typed.trim() ? `Meine Antwort:\n${entry.typed.trim()}` : '',
                entry.check?.status === 'done' ? `Bewertung:\n${entry.check.result.feedback}` : '',
              ]
                .filter(Boolean)
                .join('\n\n'),
              context: quiz.markdown.slice(0, MAX_AI_NOTE_CHARS),
            },
          ]}
          answerOnly
          onClose={() => setFollowUp(false)}
        />
      ) : null}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-muted">{children}</div>
}
