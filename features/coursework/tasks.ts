// Aufgaben wiederholen (Altklausuren, Übungsaufgaben): Nach dem Bearbeiten markiert man eine Aufgabe als gelöst,
// unsicher oder falsch. Gelöste sind erledigt; unsichere und falsche kommen nach festen Abständen wieder – gröber als
// bei Karteikarten, denn eine Aufgabe braucht mehr Zeit –, bis sie sitzen.
import { addDays } from '@/features/calendar/dates'
import type { CourseTask, TaskResult } from './types'

/** Tage bis zur nächsten Bearbeitung */
export const TASK_INTERVALS = { wrong: 3, unsure: 7 } as const

export const TASK_RESULT_LABELS: Record<TaskResult, string> = { solved: 'Gelöst', unsure: 'Unsicher', wrong: 'Falsch' }

/** Nächste Wiederholung nach einer Bearbeitung am Tag `today` (YYYY-MM-DD) – gelöste kommen nicht wieder */
export function taskDue(result: TaskResult, today: string): string | null {
  return result === 'solved' ? null : addDays(today, TASK_INTERVALS[result])
}

/** Heute dran: noch nicht bearbeitete und fällige Aufgaben */
export const isOpen = (task: Pick<CourseTask, 'result' | 'due'>, today: string) =>
  task.result === null || (task.due !== null && task.due <= today)

export type TaskCounts = Record<TaskResult | 'fresh' | 'open' | 'total', number>

export function taskCounts(tasks: Pick<CourseTask, 'result' | 'due'>[], today: string): TaskCounts {
  const counts: TaskCounts = { total: tasks.length, solved: 0, unsure: 0, wrong: 0, fresh: 0, open: 0 }
  for (const t of tasks) {
    counts[t.result ?? 'fresh']++
    if (isOpen(t, today)) counts.open++
  }
  return counts
}

/** Reihenfolge einer Wiederholung: fällige (am längsten fällige zuerst), dann neue in der Reihenfolge des Anlegens */
export function reviewOrder<T extends Pick<CourseTask, 'result' | 'due' | 'createdAt'>>(tasks: T[], today: string): T[] {
  const due = tasks.filter((t) => t.result !== null && isOpen(t, today)).sort((a, b) => a.due!.localeCompare(b.due!))
  const fresh = tasks.filter((t) => t.result === null).sort((a, b) => a.createdAt - b.createdAt)
  return [...due, ...fresh]
}

const TAGS: Record<TaskResult | 'fresh', string> = { fresh: 'neu', solved: 'gelöst', unsure: 'unsicher', wrong: 'falsch' }

/**
 * Aufgaben eines Fachs als Markdown für Obsidian: je Aufgabe eine Überschrift, der Stand als Tag (#aufgabe/falsch)
 * und die Lösung in einem eingeklappten Callout.
 */
export function tasksToMarkdown(course: string, tasks: CourseTask[]): string {
  const blocks = tasks.map((t) => {
    const state = `#aufgabe/${TAGS[t.result ?? 'fresh']}${t.due ? ` · wieder am ${t.due}` : ''}`
    const solution = t.solution.trim()
      ? `\n\n> [!success]- Lösung\n${t.solution
          .trim()
          .split('\n')
          .map((line) => (line ? `> ${line}` : '>'))
          .join('\n')}`
      : ''
    return `## ${t.title}\n${state}\n\n${t.prompt.trim()}${solution}`
  })
  return `# Aufgaben – ${course}\n\n${blocks.join('\n\n')}\n`
}
