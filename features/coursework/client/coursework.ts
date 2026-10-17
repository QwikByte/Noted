'use client'
// Übungen im Browser: Fächer, Blätter und Aufgaben laden (der Service Worker hält sie auch offline bereit) und
// Änderungen senden. Die Abgabe eines Blatts ist ein Termin im Kalender – Tag und Uhrzeit kommen aus dessen Daten, so stimmen
// sie auch, wenn der Termin im Kalender verschoben wurde.
import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/client/api'
import { calendarKey, useEvents } from '@/features/calendar/client/calendar'
import { localDate } from '@/features/calendar/dates'
import type { Course, CourseInput, CourseTask, CourseworkData, Sheet, SheetInput, TaskInput, TaskResult } from '../types'

const courseworkKey = ['coursework'] as const

/** Blatt mit seiner Abgabe aus dem Kalender (YYYY-MM-DD oder YYYY-MM-DDTHH:mm) */
export type DatedSheet = Sheet & { due: string | null }

/** Blätter nach Abgabe, ohne Abgabe zuletzt */
function byDue(a: DatedSheet, b: DatedSheet) {
  if (a.due && b.due) return a.due.localeCompare(b.due) || a.createdAt - b.createdAt
  return Number(!a.due) - Number(!b.due) || a.createdAt - b.createdAt
}

export function useCoursework() {
  const query = useQuery({ queryKey: courseworkKey, queryFn: () => api<CourseworkData>('/api/coursework') })
  const { data: events } = useEvents()
  const data = useMemo(() => {
    if (!query.data) return null
    const starts = new Map((events ?? []).map((e) => [e.id, e.start]))
    const sheets: DatedSheet[] = query.data.sheets
      .map((s) => ({ ...s, due: s.eventId ? (starts.get(s.eventId) ?? null) : null }))
      .sort(byDue)
    // Daten älterer Versionen im Offline-Speicher haben noch keine Aufgaben
    return { courses: query.data.courses, sheets, tasks: query.data.tasks ?? [] }
  }, [query.data, events])
  return { ...query, data }
}

export function useCourseworkMutations() {
  const qc = useQueryClient()
  const reload = () => qc.invalidateQueries({ queryKey: courseworkKey })
  // Abgaben ändern auch den Kalender
  const refresh = () => Promise.all([reload(), qc.invalidateQueries({ queryKey: calendarKey })])
  return {
    createCourse: useMutation({
      mutationFn: (input: CourseInput) => api<{ course: Course }>('/api/coursework/courses', { method: 'POST', body: input }),
      onSuccess: refresh,
    }),
    updateCourse: useMutation({
      mutationFn: ({ id, input }: { id: string; input: CourseInput }) =>
        api<{ course: Course }>(`/api/coursework/courses/${id}`, { method: 'PUT', body: input }),
      onSuccess: refresh,
    }),
    deleteCourse: useMutation({
      mutationFn: (id: string) => api(`/api/coursework/courses/${id}`, { method: 'DELETE' }),
      onSuccess: refresh,
    }),
    createSheet: useMutation({
      mutationFn: ({ courseId, input }: { courseId: string; input: SheetInput }) =>
        api<{ sheet: Sheet }>(`/api/coursework/courses/${courseId}/sheets`, { method: 'POST', body: input }),
      onSuccess: refresh,
    }),
    updateSheet: useMutation({
      mutationFn: ({ id, input }: { id: string; input: SheetInput }) =>
        api<{ sheet: Sheet }>(`/api/coursework/sheets/${id}`, { method: 'PUT', body: input }),
      onSuccess: refresh,
    }),
    deleteSheet: useMutation({
      mutationFn: (id: string) => api(`/api/coursework/sheets/${id}`, { method: 'DELETE' }),
      onSuccess: refresh,
    }),
    createTask: useMutation({
      mutationFn: ({ courseId, input }: { courseId: string; input: TaskInput }) =>
        api<{ task: CourseTask }>(`/api/coursework/courses/${courseId}/tasks`, { method: 'POST', body: input }),
      onSuccess: reload,
    }),
    updateTask: useMutation({
      mutationFn: ({ id, input }: { id: string; input: TaskInput }) =>
        api<{ task: CourseTask }>(`/api/coursework/tasks/${id}`, { method: 'PUT', body: input }),
      onSuccess: reload,
    }),
    deleteTask: useMutation({
      mutationFn: (id: string) => api(`/api/coursework/tasks/${id}`, { method: 'DELETE' }),
      onSuccess: reload,
    }),
    /** Bearbeitete Aufgabe bewerten – ohne alles neu zu laden (während einer Wiederholung) */
    attemptTask: useMutation({
      mutationFn: ({ id, result }: { id: string; result: TaskResult }) =>
        api<{ task: CourseTask }>(`/api/coursework/tasks/${id}/attempt`, {
          method: 'POST',
          body: { result, today: localDate(new Date()) },
        }),
      onSuccess: ({ task }) =>
        qc.setQueryData<CourseworkData>(courseworkKey, (d) =>
          d ? { ...d, tasks: d.tasks.map((t) => (t.id === task.id ? task : t)) } : d,
        ),
    }),
  }
}
