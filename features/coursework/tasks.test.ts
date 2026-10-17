import { describe, expect, it } from 'vitest'
import { isOpen, reviewOrder, taskCounts, taskDue, tasksToMarkdown } from './tasks'
import type { CourseTask } from './types'

const TODAY = '2026-10-17'

function task(id: string, patch: Partial<CourseTask> = {}): CourseTask {
  return {
    id,
    courseId: 'c1',
    title: `Aufgabe ${id}`,
    prompt: '',
    solution: '',
    result: null,
    attempts: 0,
    due: null,
    attemptedAt: null,
    createdAt: Number(id.replace(/\D/g, '')),
    updatedAt: 0,
    ...patch,
  }
}

describe('Aufgaben wiederholen', () => {
  it('plant falsche Aufgaben in drei Tagen, unsichere in einer Woche, gelöste gar nicht', () => {
    expect(taskDue('wrong', TODAY)).toBe('2026-10-20')
    expect(taskDue('unsure', TODAY)).toBe('2026-10-24')
    expect(taskDue('unsure', '2026-12-28')).toBe('2027-01-04')
    expect(taskDue('solved', TODAY)).toBeNull()
  })

  it('zählt den Stand und was heute offen ist', () => {
    const tasks = [
      task('t1'),
      task('t2', { result: 'solved' }),
      task('t3', { result: 'wrong', due: '2026-10-17' }),
      task('t4', { result: 'unsure', due: '2026-10-20' }),
      task('t5', { result: 'unsure', due: '2026-10-10' }),
    ]
    expect(tasks.map((t) => isOpen(t, TODAY))).toEqual([true, false, true, false, true])
    expect(taskCounts(tasks, TODAY)).toEqual({ total: 5, solved: 1, unsure: 2, wrong: 1, fresh: 1, open: 3 })
    // Am längsten fällige zuerst, dann neue in der Reihenfolge des Anlegens
    expect(reviewOrder([...tasks, task('t0')], TODAY).map((t) => t.id)).toEqual(['t5', 't3', 't0', 't1'])
  })

  it('exportiert Aufgaben als Markdown mit Stand als Tag und eingeklappter Lösung', () => {
    const md = tasksToMarkdown('Analysis I', [
      task('t1', { title: 'Altklausur 2024, Aufgabe 1', prompt: 'Zeige $\\lim a_n = 0$.\n', solution: 'Mit dem Sandwich-Lemma.\n\nFertig.' }),
      task('t2', { title: 'Blatt 3, Aufgabe 2', prompt: '![[blatt3.png]]', result: 'wrong', due: '2026-10-20' }),
    ])
    expect(md).toBe(
      [
        '# Aufgaben – Analysis I',
        '',
        '## Altklausur 2024, Aufgabe 1',
        '#aufgabe/neu',
        '',
        'Zeige $\\lim a_n = 0$.',
        '',
        '> [!success]- Lösung',
        '> Mit dem Sandwich-Lemma.',
        '>',
        '> Fertig.',
        '',
        '## Blatt 3, Aufgabe 2',
        '#aufgabe/falsch · wieder am 2026-10-20',
        '',
        '![[blatt3.png]]',
        '',
      ].join('\n'),
    )
  })
})
