'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/client/api'
import type { CalendarEvent, CalendarStatus } from '../types'

const statusKey = ['calendar', 'status'] as const

export function useCalendarStatus() {
  return useQuery({ queryKey: statusKey, queryFn: () => api<CalendarStatus>('/api/calendar') })
}

export function useCalendarEvents(range: { start: string; end: string }, enabled: boolean) {
  return useQuery({
    queryKey: ['calendar', 'events', range.start, range.end],
    queryFn: () =>
      api<{ events: CalendarEvent[] }>(
        `/api/calendar/events?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`,
      ).then((r) => r.events),
    enabled,
    // Ein abgelaufener Zugang wird nicht durch Wiederholen besser
    retry: false,
  })
}

/** Zur Anmeldung bei Microsoft weiterleiten; zurück geht es in die Einstellungen */
export async function connectCalendar() {
  const { url } = await api<{ url: string }>('/api/calendar/connect', { method: 'POST' })
  window.location.assign(url)
}

export function useCalendarMutations() {
  const qc = useQueryClient()
  const refresh = (status?: CalendarStatus) => {
    if (status) qc.setQueryData(statusKey, status)
    void qc.invalidateQueries({ queryKey: ['calendar'] })
  }
  return {
    select: useMutation({
      mutationFn: (calendars: string[]) => api<CalendarStatus>('/api/calendar', { method: 'PUT', body: { calendars } }),
      onSuccess: refresh,
    }),
    disconnect: useMutation({
      mutationFn: () => api('/api/calendar', { method: 'DELETE' }),
      onSuccess: () => refresh({ configured: true, connected: false }),
    }),
  }
}
