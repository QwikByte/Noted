'use client'
// Termine im Browser: alle auf einmal laden (der Service Worker hält sie auch offline bereit) und Änderungen senden.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/client/api'
import { parseIcs } from '../ics'
import type { CalendarEvent, EventInput } from '../types'

export const calendarKey = ['calendar'] as const

export function useEvents() {
  return useQuery({
    queryKey: calendarKey,
    // Bis Version 1.6.0 lieferte dieselbe Adresse den Stand der Microsoft-Anbindung – der kann noch im Cache liegen
    queryFn: () => api<{ events?: unknown }>('/api/calendar').then((r) => (Array.isArray(r.events) ? (r.events as CalendarEvent[]) : [])),
  })
}

/** Die Ortszeit des Geräts – in sie werden Zeiten aus .ics-Dateien umgerechnet */
export const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

export type ImportSummary = { created: number; duplicates: number; skipped: number; simplified: number }

export function useEventMutations() {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: calendarKey })
  return {
    create: useMutation({
      mutationFn: (input: EventInput) => api<{ event: CalendarEvent }>('/api/calendar', { method: 'POST', body: input }),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: EventInput }) =>
        api<{ event: CalendarEvent }>(`/api/calendar/${id}`, { method: 'PUT', body: input }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api(`/api/calendar/${id}`, { method: 'DELETE' }),
      onSuccess: refresh,
    }),
    /** Nur einen Termin einer Serie ändern (input) oder ausfallen lassen (null) */
    occurrence: useMutation({
      mutationFn: ({ id, date, input }: { id: string; date: string; input: EventInput | null }) =>
        api(`/api/calendar/${id}/occurrence`, { method: 'POST', body: { date, event: input } }),
      onSuccess: refresh,
    }),
    /** .ics-Datei im Browser lesen (dort ist die Zeitzone bekannt) und die Termine hochladen */
    importFile: useMutation({
      mutationFn: async (file: File): Promise<ImportSummary> => {
        const { events, skipped, simplified } = parseIcs(await file.text(), deviceTimeZone())
        const res = await api<{ created: number; duplicates: number }>('/api/calendar/import', { method: 'POST', body: { events } })
        return { ...res, skipped, simplified }
      },
      onSuccess: refresh,
    }),
  }
}
