'use client'
// Aufgaben eines Fachs (Altklausuren, Übungsaufgaben): sammeln, Stand sehen und offene wiederholen
import { useState } from 'react'
import { ChevronRight, ClipboardCheck, ListChecks, Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useApp } from '@/features/workspace/client/context'
import { AutoTextarea } from '@/features/flashcards/components/CardEditor'
import { localDate, shortDate, weekdayShort } from '@/features/calendar/dates'
import { Page, PageHeader } from '@/shared/ui/page-layout'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Field, Input } from '@/shared/ui/input'
import { ConfirmModal, Modal } from '@/shared/ui/modal'
import { cn } from '@/shared/ui/cn'
import { errorMessage } from '@/shared/client/api'
import { useNow } from '@/shared/client/now'
import { makeExcerpt } from '@/shared/markdown/meta'
import { useCoursework, useCourseworkMutations } from '../client/coursework'
import { MAX_TASK_TEXT, MAX_TASK_TITLE } from '../limits'
import { isOpen, TASK_RESULT_LABELS, taskCounts, type TaskCounts } from '../tasks'
import type { Course, CourseTask, TaskResult } from '../types'

const RESULT_COLORS: Record<TaskResult | 'fresh', string> = {
  solved: 'bg-success',
  unsure: 'bg-warning',
  wrong: 'bg-danger',
  fresh: 'bg-border-strong',
}
const RESULT_TONES = { solved: 'success', unsure: 'warning', wrong: 'danger' } as const

/** Anteil gelöster, unsicherer, falscher und neuer Aufgaben */
export function TaskBar({ counts, className }: { counts: TaskCounts; className?: string }) {
  const parts = (['solved', 'unsure', 'wrong', 'fresh'] as const).filter((k) => counts[k] > 0)
  return (
    <div
      className={cn('flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-subtle', className)}
      role="img"
      aria-label={`${counts.solved} gelöst, ${counts.unsure} unsicher, ${counts.wrong} falsch, ${counts.fresh} neu`}
    >
      {parts.map((k) => (
        <div key={k} className={RESULT_COLORS[k]} style={{ width: `${(counts[k] / counts.total) * 100}%` }} />
      ))}
    </div>
  )
}

export function TasksView({ courseId }: { courseId: string }) {
  const app = useApp()
  const { data, isLoading } = useCoursework()
  const today = localDate(new Date(useNow()))
  const [editing, setEditing] = useState<CourseTask | 'new' | null>(null)
  const course = data?.courses.find((c) => c.id === courseId)

  if (!data || !course) {
    return (
      <Page>
        {isLoading ? (
          <Loader2 className="mx-auto size-6 animate-spin text-faint" />
        ) : (
          <div className="space-y-3 text-center text-muted">
            <p>Dieses Fach gibt es nicht (mehr).</p>
            <Button onClick={() => app.go({ kind: 'coursework' })}>Zu den Übungen</Button>
          </div>
        )}
      </Page>
    )
  }

  const tasks = data.tasks.filter((t) => t.courseId === course.id)
  const counts = taskCounts(tasks, today)
  const review = () => app.go({ kind: 'tasks', course: course.id, review: true })

  return (
    <Page>
      <PageHeader
        breadcrumb={
          <button type="button" onClick={() => app.go({ kind: 'coursework' })} className="mb-2 flex items-center gap-1 text-sm text-muted hover:text-fg">
            <ClipboardCheck className="size-3.5" /> Übungen <ChevronRight className="size-3.5" />
          </button>
        }
        title={`Aufgaben – ${course.name}`}
        subtitle="Altklausuren und Übungsaufgaben wiederholen, bis sie sitzen"
      />

      <div className="mb-6 rounded-xl border border-border bg-elevated p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div>
            <p className="text-3xl font-bold tabular-nums">{counts.open}</p>
            <p className="text-sm text-muted">heute offen</p>
          </div>
          <p className="text-sm text-muted">
            {counts.total === 0
              ? 'Noch keine Aufgaben.'
              : `${Math.floor((counts.solved / counts.total) * 100)} % gelöst · ${counts.unsure} unsicher · ${counts.wrong} falsch · ${counts.fresh} neu`}
          </p>
          <div className="flex flex-1 justify-end gap-2 max-sm:w-full">
            {counts.open > 0 ? (
              <Button variant="primary" className="max-sm:flex-1" onClick={review} data-testid="tasks-review">
                <ListChecks className="size-4" /> Wiederholen ({counts.open})
              </Button>
            ) : counts.total > 0 ? (
              <Button className="max-sm:flex-1" onClick={review}>
                <RotateCcw className="size-4" /> Alle noch einmal
              </Button>
            ) : null}
            <Button className="max-sm:flex-1" onClick={() => setEditing('new')} data-testid="add-task">
              <Plus className="size-4" /> Aufgabe
            </Button>
          </div>
        </div>
        {counts.total > 0 ? <TaskBar counts={counts} className="mt-4" /> : null}
      </div>

      {tasks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-strong px-6 py-10 text-center text-sm text-muted">
          Sammle hier Aufgaben aus Altklausuren und Übungsblättern – als Text mit Formeln, als Bild oder mit einem Link auf die
          PDF-Seite, gern mit Lösung. Nach dem Bearbeiten markierst du sie als gelöst, unsicher oder falsch; unsichere kommen
          nach einer Woche wieder, falsche nach drei Tagen.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="task-list">
          {tasks.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setEditing(t)}
                className="flex w-full items-start gap-3 rounded-lg border border-border bg-elevated px-4 py-3 text-left hover:border-border-strong"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{t.title}</span>
                  {t.prompt ? <span className="line-clamp-1 text-sm text-muted">{makeExcerpt(t.prompt, 160)}</span> : null}
                </span>
                <TaskState task={t} today={today} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing ? <TaskDialog course={course} task={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </Page>
  )
}

function TaskState({ task, today }: { task: CourseTask; today: string }) {
  if (!task.result) return <Badge>Neu</Badge>
  const when = isOpen(task, today) ? ' · fällig' : task.due ? ` · wieder ${weekdayShort(task.due)}, ${shortDate(task.due)}` : ''
  return <Badge tone={RESULT_TONES[task.result]}>{`${TASK_RESULT_LABELS[task.result]}${when}`}</Badge>
}

/** Aufgabe anlegen oder ändern */
function TaskDialog({ course, task, onClose }: { course: Course; task: CourseTask | null; onClose: () => void }) {
  const m = useCourseworkMutations()
  const [title, setTitle] = useState(task?.title ?? '')
  const [prompt, setPrompt] = useState(task?.prompt ?? '')
  const [solution, setSolution] = useState(task?.solution ?? '')
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const busy = m.createTask.isPending || m.updateTask.isPending

  async function save() {
    if (!title.trim()) return setError('Bitte gib einen Titel ein.')
    const input = { title, prompt, solution }
    try {
      if (task) await m.updateTask.mutateAsync({ id: task.id, input })
      else await m.createTask.mutateAsync({ courseId: course.id, input })
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function remove() {
    if (!task) return
    try {
      await m.deleteTask.mutateAsync(task.id)
      onClose()
    } catch (err) {
      setConfirmDelete(false)
      setError(errorMessage(err))
    }
  }

  return (
    <>
      <Modal
        open
        onClose={onClose}
        size="lg"
        title={task ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'}
        description={course.name}
        footer={
          <>
            {task ? (
              <Button variant="ghost" className="mr-auto text-danger hover:text-danger" onClick={() => setConfirmDelete(true)} disabled={busy}>
                <Trash2 className="size-4" /> Löschen
              </Button>
            ) : null}
            <Button onClick={onClose}>Abbrechen</Button>
            <Button variant="primary" onClick={() => void save()} loading={busy}>
              Speichern
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Titel">
            {(id) => (
              <Input
                id={id}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={MAX_TASK_TITLE}
                placeholder="z. B. Altklausur WS 24/25, Aufgabe 3"
                autoFocus={!task}
              />
            )}
          </Field>
          <Field label="Aufgabe" hint="Markdown, $Formeln$, Bilder ![[…]] und Links wie [[Altklausur.pdf#page=3]] sind möglich.">
            {(id) => <AutoTextarea id={id} value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={MAX_TASK_TEXT} minRows={4} />}
          </Field>
          <Field label="Lösung (optional)">
            {(id) => <AutoTextarea id={id} value={solution} onChange={(e) => setSolution(e.target.value)} maxLength={MAX_TASK_TEXT} minRows={3} />}
          </Field>
          {error ? (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </Modal>
      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Aufgabe löschen?"
        description={`„${task?.title}“ wird gelöscht.`}
        confirmLabel="Löschen"
        danger
        loading={m.deleteTask.isPending}
        onConfirm={() => void remove()}
      />
    </>
  )
}
