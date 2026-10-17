'use client'
// Übungen: je Fach die Übungsblätter mit Punkten und der Stand der Klausurzulassung
import { useState } from 'react'
import { ChevronRight, ClipboardCheck, CloudOff, ListChecks, Loader2, Pencil, Plus } from 'lucide-react'
import { useApp } from '@/features/workspace/client/context'
import { dateOf, localDate, shortDate, timeOf, weekdayShort } from '@/features/calendar/dates'
import { Page, PageHeader } from '@/shared/ui/page-layout'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { NetworkError } from '@/shared/client/api'
import { useNow } from '@/shared/client/now'
import { useCoursework, type DatedSheet } from '../client/coursework'
import { admission, admissionHint, formatPoints, type Admission } from '../admission'
import { taskCounts } from '../tasks'
import { CourseDialog, SheetDialog } from './CourseworkDialogs'
import { TaskBar } from './TasksView'
import type { Course, CourseTask } from '../types'

type Dialog = { kind: 'course'; course: Course | null } | { kind: 'sheet'; course: Course; sheet: DatedSheet | null }

/** „Di, 27.10. · 12:00“ */
const dueLabel = (due: string) => `${weekdayShort(dateOf(due))}, ${shortDate(dateOf(due))}${due.length > 10 ? ` · ${timeOf(due)}` : ''}`

export function CourseworkView() {
  const { data, isLoading, error } = useCoursework()
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const sheetsOf = (course: Course) => data?.sheets.filter((s) => s.courseId === course.id) ?? []

  return (
    <Page>
      <PageHeader
        icon={<ClipboardCheck />}
        title="Übungen"
        subtitle="Übungsblätter und Klausurzulassung je Fach"
        actions={
          data && data.courses.length > 0 ? (
            <Button size="sm" variant="primary" onClick={() => setDialog({ kind: 'course', course: null })}>
              <Plus className="size-4" /> Fach
            </Button>
          ) : null
        }
      />

      {isLoading ? (
        <Loader2 className="mx-auto size-6 animate-spin text-faint" />
      ) : !data ? (
        <div className="flex items-center gap-2 rounded-lg border border-border p-4 text-sm text-muted">
          <CloudOff className="size-4" />
          {error instanceof NetworkError ? 'Offline – die Übungen wurden auf diesem Gerät noch nicht geladen.' : 'Die Übungen konnten nicht geladen werden.'}
        </div>
      ) : data.courses.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-border-strong px-6 py-12 text-center">
          <ClipboardCheck className="mb-3 size-9 stroke-[1.5] text-faint" />
          <p className="font-semibold">Noch keine Fächer</p>
          <p className="mt-1 max-w-md text-sm text-muted">
            Leg je Fach die nötige Quote für die Klausurzulassung an und trag die Übungsblätter mit ihren Punkten ein. Noted
            rechnet aus, wie viele Punkte dir noch fehlen – die Abgaben stehen im Kalender.
          </p>
          <Button variant="primary" className="mt-4" onClick={() => setDialog({ kind: 'course', course: null })}>
            <Plus className="size-4" /> Erstes Fach anlegen
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {data.courses.map((course) => (
            <CourseCard
              key={course.id}
              course={course}
              sheets={sheetsOf(course)}
              tasks={data.tasks.filter((t) => t.courseId === course.id)}
              onEdit={() => setDialog({ kind: 'course', course })}
              onSheet={(sheet) => setDialog({ kind: 'sheet', course, sheet })}
            />
          ))}
        </div>
      )}

      {dialog?.kind === 'course' ? <CourseDialog course={dialog.course} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === 'sheet' ? (
        <SheetDialog course={dialog.course} sheet={dialog.sheet} sheets={sheetsOf(dialog.course)} onClose={() => setDialog(null)} />
      ) : null}
    </Page>
  )
}

function CourseCard({
  course,
  sheets,
  tasks,
  onEdit,
  onSheet,
}: {
  course: Course
  sheets: DatedSheet[]
  tasks: CourseTask[]
  onEdit: () => void
  onSheet: (sheet: DatedSheet | null) => void
}) {
  const app = useApp()
  const a = admission(course, sheets)
  const counts = taskCounts(tasks, localDate(new Date(useNow())))
  return (
    <section className="rounded-xl border border-border bg-elevated p-4" aria-label={course.name} data-testid="course">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{course.name}</h2>
          <p className="text-xs text-muted">
            Zulassung ab {formatPoints(course.requiredPercent)} % der Punkte
            {course.plannedSheets ? ` · ${course.plannedSheets} Blätter im Semester` : ''}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label="Fach bearbeiten" title="Fach bearbeiten">
          <Pencil className="size-4" />
        </Button>
      </div>

      {a.state === 'empty' ? null : <AdmissionBar a={a} percent={course.requiredPercent} />}
      <p
        className={cn('mt-2 text-sm', a.state === 'reached' ? 'text-success' : a.state === 'unreachable' ? 'text-danger' : 'text-fg')}
        data-testid="admission-hint"
      >
        {admissionHint(a)}
      </p>

      {sheets.length > 0 ? (
        <ul className="mt-3 divide-y divide-border border-t border-border">
          {sheets.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSheet(s)}
                className="flex w-full items-center gap-3 rounded-md px-1 py-2 text-left text-sm hover:bg-hover"
                data-testid="sheet"
              >
                <span className="min-w-0 flex-1 truncate font-medium">{s.title}</span>
                <span className="shrink-0 text-xs text-muted tabular-nums">
                  {s.due ? (
                    <>
                      <span className="max-sm:hidden">Abgabe </span>
                      {dueLabel(s.due)}
                    </>
                  ) : (
                    'ohne Abgabe'
                  )}
                </span>
                <span className="w-24 shrink-0 text-right tabular-nums">
                  {s.points === null ? <span className="text-faint">–</span> : formatPoints(s.points)}
                  <span className="text-muted"> / {formatPoints(s.maxPoints)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Button variant="ghost" size="sm" className="mt-2" onClick={() => onSheet(null)}>
        <Plus className="size-4" /> Übungsblatt
      </Button>

      {/* Aufgaben aus Altklausuren und Übungen zum Wiederholen */}
      <button
        type="button"
        onClick={() => app.go({ kind: 'tasks', course: course.id })}
        className="mt-3 flex w-full items-center gap-3 rounded-md border-t border-border px-1 pt-3 text-left text-sm hover:text-fg"
        data-testid="course-tasks"
      >
        <ListChecks className="size-4 shrink-0 text-faint" />
        <span className="min-w-0 flex-1">
          <span className="font-medium">Aufgaben</span>
          <span className="text-muted">
            {counts.total === 0
              ? ' – Altklausuren und Übungsaufgaben wiederholen'
              : ` · ${counts.total} · ${Math.floor((counts.solved / counts.total) * 100)} % gelöst${counts.open > 0 ? ` · ${counts.open} offen` : ''}`}
          </span>
          {counts.total > 0 ? <TaskBar counts={counts} className="mt-1.5 max-w-xs" /> : null}
        </span>
        <ChevronRight className="size-4 shrink-0 text-faint" />
      </button>
    </section>
  )
}

/** Erreichte Punkte gegen die nötige Quote (Strich) */
function AdmissionBar({ a, percent }: { a: Admission; percent: number }) {
  const share = a.total > 0 ? Math.min(100, (a.achieved / a.total) * 100) : 0
  return (
    <div className="mt-3">
      <div
        className="relative h-2 rounded-full bg-subtle"
        role="img"
        aria-label={`${formatPoints(a.achieved)} von ${formatPoints(a.total)} Punkten, nötig sind ${formatPoints(a.required)}`}
      >
        <div
          className={cn('h-full rounded-full', a.state === 'reached' ? 'bg-success' : a.state === 'unreachable' ? 'bg-danger' : 'bg-accent')}
          style={{ width: `${share}%` }}
        />
        <div className="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-full bg-fg" style={{ left: `${percent}%` }} />
      </div>
      <div className="mt-1 flex justify-between gap-2 text-xs text-muted tabular-nums">
        <span>
          {formatPoints(a.achieved)} von {a.estimated ? 'etwa ' : ''}
          {formatPoints(a.total)} Punkten
        </span>
        <span>nötig: {formatPoints(a.required)}</span>
      </div>
    </div>
  )
}
