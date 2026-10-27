'use client'
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { api, apiResponse } from '@/shared/client/api'
import { readAssistEvents } from '../assist'
import type { AiModel } from '../models'
import type { AiSettings, AssistEvent, AssistRequest, CardsRequest, MetaSuggestion, SuggestedCard } from '../types'

const aiSettingsKey = ['ai', 'settings'] as const

/** KI-Einstellungen des Kontos – ob ein Schlüssel hinterlegt ist und welches Modell gilt */
export function useAiSettings() {
  return useQuery({
    queryKey: aiSettingsKey,
    queryFn: () => api<{ settings: AiSettings }>('/api/ai/settings').then((r) => r.settings),
  })
}

/** Ist die KI für das Konto eingerichtet? Solange das unklar ist (laden, offline): nein */
export function useAiReady(): boolean {
  return useAiSettings().data?.configured === true
}

/** Schlüssel hinterlegen und/oder Modell wechseln – ohne `apiKey` bleibt der bisherige */
export async function saveAiSettings(qc: QueryClient, body: { apiKey?: string; model: AiModel }) {
  const { settings } = await api<{ settings: AiSettings }>('/api/ai/settings', { method: 'PUT', body })
  qc.setQueryData(aiSettingsKey, settings)
  return settings
}

export async function removeAiKey(qc: QueryClient) {
  const { settings } = await api<{ settings: AiSettings }>('/api/ai/settings', { method: 'DELETE' })
  qc.setQueryData(aiSettingsKey, settings)
}

/** Karten von Claude vorschlagen lassen – aus einer Notiz, einem PDF oder einer vorhandenen Karte */
export async function suggestCards(request: CardsRequest, signal: AbortSignal): Promise<SuggestedCard[]> {
  return (await api<{ cards: SuggestedCard[] }>('/api/ai/cards', { method: 'POST', body: request, signal })).cards
}

/** Titel und Tags für eine Notiz vorschlagen lassen */
export function suggestMeta(input: { noteId: string; title: string; content: string }, signal: AbortSignal) {
  return api<MetaSuggestion>('/api/ai/meta', { method: 'POST', body: input, signal })
}

/** Assistent: Die Antwort kommt Stück für Stück – `onEvent` bekommt jedes Ereignis, sobald es da ist */
export async function streamAssist(request: AssistRequest, signal: AbortSignal, onEvent: (e: AssistEvent) => void) {
  const res = await apiResponse('/api/ai/assist', { method: 'POST', body: request, signal })
  const reader = res.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const { events, rest } = readAssistEvents(buffer + decoder.decode(value, { stream: true }))
    buffer = rest
    events.forEach(onEvent)
  }
  readAssistEvents(buffer + decoder.decode() + '\n').events.forEach(onEvent)
}

/** JPEG oder PNG als base64 für Claude (ohne „data:“-Präfix) */
export async function blobToAiImage(blob: Blob): Promise<{ mediaType: 'image/jpeg' | 'image/png'; data: string }> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  // In Stücken: String.fromCharCode mit Hunderttausenden Argumenten sprengt den Stack
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { mediaType: blob.type === 'image/png' ? 'image/png' : 'image/jpeg', data: btoa(binary) }
}
