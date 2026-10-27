'use client'
// KI-Assistent für Notizen und PDFs: Text ändern lassen (das Ergebnis erscheint als Vorschau mit Vergleich und wird
// erst auf Wunsch übernommen) oder Fragen dazu beantworten lassen. Die Antwort kommt Stück für Stück.
import { useEffect, useRef, useState } from 'react'
import { ClipboardCopy, FilePlus, Send, Sparkles, Square } from 'lucide-react'
import { useApp } from '@/features/workspace/client/context'
import { DiffView } from '@/features/notes/components/DiffView'
import { CardMarkdown } from '@/features/flashcards/components/CardMarkdown'
import { Modal } from '@/shared/ui/modal'
import { Button } from '@/shared/ui/button'
import { ErrorText, useToast } from '@/shared/ui/toast'
import { cn } from '@/shared/ui/cn'
import { copyText } from '@/shared/client/clipboard'
import { errorMessage } from '@/shared/client/api'
import { sanitizeName } from '@/shared/lib/names'
import { streamAssist, useAiSettings } from '../client/ai'
import { ASSIST_ACTIONS, stripFence, type AssistAction } from '../assist'
import { MAX_AI_WISHES } from '../limits'
import { modelLabel } from '../models'
import type { AiImage, AssistTask } from '../types'
import { AiSetupHint } from './AiSetupHint'

/** Worauf sich der Auftrag bezieht, z. B. „Markierung“ oder „Ganze Notiz“ – `context`: die ganze Notiz dazu */
export type AssistScope = { label: string; text: string; context?: string; images?: AiImage[] }

type Result = {
  task: AssistTask
  /** Text, auf dem das Ergebnis beruht – für den Vergleich */
  before: string
  text: string
  status: 'running' | 'done' | 'error'
  truncated: boolean
}

const TASK_LABELS: Record<AssistTask, string> = { edit: 'Text ändern', answer: 'Frage stellen' }

export function AiAssistant({
  title,
  noteId,
  plain,
  scopes,
  answerOnly,
  initialAction,
  insertLabel = 'In die Notiz einfügen',
  onReplace,
  onInsert,
  onClose,
}: {
  /** Titel der Notiz bzw. Name des PDFs */
  title: string
  /** Notiz, aus der der Text stammt – der Server prüft, dass sie nicht im Tresor liegt */
  noteId?: string
  /** Einfacher Text statt Markdown */
  plain?: boolean
  /** Wählbare Bereiche, der erste ist vorausgewählt */
  scopes: AssistScope[]
  /** Nur Fragen beantworten (z. B. im PDF, das sich nicht ändern lässt) */
  answerOnly?: boolean
  /** Schnellaktion, die gleich beim Öffnen startet (z. B. „Erklären“ aus einem Menü) */
  initialAction?: string
  insertLabel?: string
  /** Ergebnis anstelle des Bereichs setzen – false, wenn der Text dort inzwischen geändert wurde */
  onReplace?: (scope: number, markdown: string) => boolean
  /** Ergebnis unter dem Bereich bzw. in die Notiz einfügen – false, wenn das nicht ging */
  onInsert?: (scope: number, markdown: string) => boolean
  onClose: () => void
}) {
  const app = useApp()
  const toast = useToast()
  const { data: settings } = useAiSettings()
  const [scope, setScope] = useState(0)
  // Aus einem Menü mit Aktion geöffnet (z. B. „Erklären“): Sie läuft gleich los, sobald die KI bereitsteht
  const [initial] = useState(() => ASSIST_ACTIONS.find((a) => a.id === initialAction) ?? null)
  const [task, setTask] = useState<AssistTask>(initial?.task ?? (answerOnly ? 'answer' : 'edit'))
  const [prompt, setPrompt] = useState('')
  const [result, setResult] = useState<Result | null>(() =>
    initial ? { task: initial.task, before: scopes[0].text, text: '', status: 'running', truncated: false } : null,
  )
  const [view, setView] = useState<'result' | 'diff'>('result')
  const [error, setError] = useState<string | null>(null)
  const running = useRef<AbortController | null>(null)
  const actions = ASSIST_ACTIONS.filter((a) => !answerOnly || a.task === 'answer')
  const current = scopes[scope] ?? scopes[0]
  const busy = result?.status === 'running'

  // Geschlossen: Anfrage abbrechen, damit Claude nicht umsonst weiterschreibt
  useEffect(() => () => running.current?.abort(), [])

  /**
   * Antwort holen und Stück für Stück in `result` schreiben. Setzt Zustand erst, wenn etwas ankommt – den Anfang
   * („Claude schreibt …“) setzt der Aufrufer.
   */
  async function stream(request: { task: AssistTask; instruction: string; text: string; images?: AiImage[] }) {
    running.current?.abort()
    const controller = new AbortController()
    running.current = controller
    let output = ''
    let finished = false
    const update = (patch: Partial<Result>) => setResult((r) => (r ? { ...r, ...patch } : r))
    try {
      await streamAssist(
        { ...request, title, context: current.context, plain, noteId },
        controller.signal,
        (e) => {
          if ('text' in e) {
            output += e.text
            update({ text: output })
          } else if ('reset' in e) {
            output = ''
            update({ text: '' })
          } else if ('done' in e) {
            finished = true
            update({ text: stripFence(output).trim(), status: 'done', truncated: e.truncated })
          } else {
            finished = true
            setError(e.error)
            update({ status: 'error' })
          }
        },
      )
      if (!finished && !controller.signal.aborted) {
        setError('Die Antwort ist unterwegs abgebrochen. Versuch es noch einmal.')
        update({ status: 'error' })
      }
    } catch (err) {
      if (controller.signal.aborted) return
      setError(errorMessage(err))
      update({ status: 'error' })
    } finally {
      if (running.current === controller) running.current = null
    }
  }

  /** `refine`: das bisherige Ergebnis weiter ändern statt den ursprünglichen Text */
  function run(nextTask: AssistTask, instruction: string, refine = false) {
    const text = refine && result ? result.text : current.text
    setError(null)
    setView('result')
    setResult({ task: nextTask, before: current.text, text: '', status: 'running', truncated: false })
    void stream({ task: nextTask, instruction, text, images: refine ? undefined : current.images })
  }

  function runAction(action: AssistAction) {
    setTask(action.task)
    run(action.task, action.instruction)
  }

  function submitPrompt() {
    const instruction = prompt.trim()
    if (!instruction || busy) return
    setPrompt('')
    // Nach einer Änderung bezieht sich ein weiterer Auftrag auf deren Ergebnis („noch kürzer“)
    run(task, instruction, task === 'edit' && result?.task === 'edit' && result.status === 'done')
  }

  function stop() {
    running.current?.abort()
    running.current = null
    setResult((r) => (r?.text ? { ...r, status: 'done' } : null))
  }

  const ready = settings?.configured === true
  useEffect(() => {
    if (!ready || !initial) return
    // Erst nach dem Rendern losschicken: Im StrictMode räumt React den ersten Durchlauf sofort wieder ab – so geht dann
    // gar keine Anfrage hinaus statt einer abgebrochenen
    const timer = setTimeout(() => {
      void stream({ task: initial.task, instruction: initial.instruction, text: scopes[0].text, images: scopes[0].images })
    })
    return () => {
      clearTimeout(timer)
      running.current?.abort()
    }
    // Nur einmal beim Öffnen – der Anfangszustand steht schon
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  function apply(how: 'replace' | 'insert') {
    if (!result) return
    const ok = how === 'replace' ? onReplace?.(scope, result.text) : onInsert?.(scope, result.text)
    if (!ok) {
      setError('Der Text wurde inzwischen geändert. Markiere ihn neu und versuch es noch einmal.')
      return
    }
    toast.success('Übernommen – Strg+Z macht es rückgängig.')
    onClose()
  }

  async function newNote() {
    if (!result) return
    try {
      const name = sanitizeName(`${title.replace(/\.pdf$/i, '')} – KI`)
      await app.createNote({ title: name, folderId: null, content: result.text, format: 'markdown' })
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const done = result?.status === 'done' && result.text.trim() !== ''
  const footer = (
    <>
      {busy ? (
        <Button onClick={stop}>
          <Square className="size-4" /> Abbrechen
        </Button>
      ) : (
        <Button onClick={onClose}>{done ? 'Verwerfen' : 'Schließen'}</Button>
      )}
      {done ? (
        <>
          <Button
            onClick={async () => {
              if (await copyText(result.text)) toast.success('Kopiert.')
            }}
          >
            <ClipboardCopy className="size-4" /> Kopieren
          </Button>
          {result.task === 'answer' ? (
            <Button onClick={() => void newNote()}>
              <FilePlus className="size-4" /> Als neue Notiz
            </Button>
          ) : null}
          {onInsert ? (
            <Button variant={result.task === 'answer' ? 'primary' : 'secondary'} onClick={() => apply('insert')}>
              {result.task === 'answer' ? insertLabel : 'Darunter einfügen'}
            </Button>
          ) : null}
          {result.task === 'edit' && onReplace ? (
            <Button variant="primary" onClick={() => apply('replace')} data-testid="ai-replace">
              Ersetzen
            </Button>
          ) : null}
        </>
      ) : null}
    </>
  )

  return (
    <Modal open onClose={onClose} title="KI-Assistent" description={`„${title}“`} size="lg" footer={footer}>
      {!settings ? null : !settings.configured ? (
        <AiSetupHint what="Mit Claude Texte überarbeiten und Fragen beantworten" />
      ) : (
        <div className="space-y-4" data-testid="ai-assistant">
          {scopes.length > 1 ? (
            <div className="flex gap-0.5 rounded-xl bg-subtle p-1" role="radiogroup" aria-label="Bereich">
              {scopes.map((s, i) => (
                <button
                  key={s.label}
                  type="button"
                  role="radio"
                  aria-checked={scope === i}
                  disabled={busy}
                  onClick={() => {
                    setScope(i)
                    setResult(null)
                  }}
                  className={cn(
                    'h-8 flex-1 rounded-lg px-2 text-sm whitespace-nowrap transition-colors',
                    scope === i ? 'bg-elevated font-medium text-fg shadow-sm' : 'text-muted hover:text-fg',
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">Bereich: {current.label}</p>
          )}

          <div className="flex flex-wrap gap-1.5" aria-label="Schnellaktionen">
            {actions.map((a) => (
              <Button key={a.id} size="sm" variant="subtle" disabled={busy} onClick={() => runAction(a)}>
                {a.label}
              </Button>
            ))}
          </div>

          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault()
              submitPrompt()
            }}
          >
            {answerOnly ? null : (
              <div className="flex gap-3 text-sm" role="radiogroup" aria-label="Art des Auftrags">
                {(['edit', 'answer'] as AssistTask[]).map((t) => (
                  <label key={t} className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="radio"
                      name="ai-task"
                      checked={task === t}
                      onChange={() => setTask(t)}
                      className="accent-[var(--accent)]"
                    />
                    {TASK_LABELS[t]}
                  </label>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    submitPrompt()
                  }
                }}
                maxLength={MAX_AI_WISHES}
                rows={2}
                aria-label="Auftrag an Claude"
                placeholder={
                  task === 'answer'
                    ? 'Frage, z. B. „Was ist der Unterschied zwischen … und …?“'
                    : result?.task === 'edit' && result.status === 'done'
                      ? 'Weiter anpassen, z. B. „noch kürzer“'
                      : 'Auftrag, z. B. „als Tabelle“ oder „in einfacher Sprache“'
                }
                className="min-h-11 flex-1 resize-y rounded-lg border border-border-strong/70 bg-elevated px-3 py-2 text-[15px] outline-none focus:border-accent focus:ring-3 focus:ring-accent/20"
              />
              <Button type="submit" variant="primary" disabled={busy || !prompt.trim()} aria-label="Senden">
                <Send className="size-4" />
              </Button>
            </div>
          </form>

          <ErrorText>{error}</ErrorText>

          {result && (result.text || busy) ? (
            <section className="rounded-xl border border-border" aria-live="polite" data-testid="ai-result">
              <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <Sparkles className="size-4 text-accent-text" />
                <span className="flex-1 text-sm font-medium">{busy ? 'Claude schreibt …' : 'Vorschlag'}</span>
                {result.task === 'edit' && !busy ? (
                  <div className="flex rounded-lg bg-subtle p-0.5 text-xs" role="radiogroup" aria-label="Ansicht">
                    {(['result', 'diff'] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        role="radio"
                        aria-checked={view === v}
                        onClick={() => setView(v)}
                        className={cn('rounded-md px-2 py-1', view === v ? 'bg-elevated font-medium shadow-sm' : 'text-muted')}
                      >
                        {v === 'result' ? 'Neu' : 'Vergleich'}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="max-h-[50vh] overflow-y-auto p-3">
                {view === 'diff' && result.task === 'edit' && !busy ? (
                  <DiffView before={result.before} after={result.text} labels={{ removed: 'bisher', added: 'neu' }} />
                ) : result.task === 'answer' && !busy ? (
                  <CardMarkdown text={result.text} className="markdown-body text-[15px]" />
                ) : (
                  <p className="font-mono text-[13px] leading-relaxed whitespace-pre-wrap">
                    {result.text}
                    {busy ? <span className="animate-pulse">▍</span> : null}
                  </p>
                )}
              </div>
              {result.truncated ? (
                <p className="border-t border-border px-3 py-2 text-xs text-warning">
                  Die Antwort ist an der Längengrenze abgeschnitten – nimm einen kleineren Bereich.
                </p>
              ) : null}
            </section>
          ) : null}

          <p className="text-xs text-muted">
            {current.images?.length ? 'Text und Bilder gehen' : 'Der Text geht'} an Anthropic ({modelLabel(settings.model)}).
          </p>
        </div>
      )}
    </Modal>
  )
}
