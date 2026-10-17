'use client'
// Übungen im Browser: Fächer und Blätter laden (der Service Worker hält sie auch offline bereit) und Änderungen
// senden. Die Abgabe eines Blatts ist ein Termin im Kalender – Tag und Uhrzeit kommen aus dessen Daten, so stimmen
// sie auch, wenn der Termin im Kalender verschoben wurde.
import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/client/api'
import { calendarKey, useEvents } from '@/features/calendar/client/calendar'
import type { Course, CourseInput, CourseworkData, Sheet, SheetInput } from '../types'

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
    return { courses: query.data.courses, sheets }
  }, [query.data, events])
  return { ...query, data }
}

export function useCourseworkMutations() {
  const qc = useQueryClient()
  // Abgaben ändern auch den Kalender
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: courseworkKey }), qc.invalidateQueries({ queryKey: calendarKey })])
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
  }
}
