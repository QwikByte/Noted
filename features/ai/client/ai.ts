'use client'
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { api } from '@/shared/client/api'
import type { AiModel } from '../models'
import type { AiSettings, SuggestedCard } from '../types'

const aiSettingsKey = ['ai', 'settings'] as const

/** KI-Einstellungen des Kontos – ob ein Schlüssel hinterlegt ist und welches Modell gilt */
export function useAiSettings() {
  return useQuery({
    queryKey: aiSettingsKey,
    queryFn: () => api<{ settings: AiSettings }>('/api/ai/settings').then((r) => r.settings),
  })
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

/** Karten von Claude vorschlagen lassen – `existing`: Vorderseiten der Karten, die es zur Notiz schon gibt */
export async function suggestCards(
  input: { noteId: string; title: string; content: string; existing: string[]; wishes: string },
  signal: AbortSignal,
): Promise<SuggestedCard[]> {
  return (await api<{ cards: SuggestedCard[] }>('/api/ai/cards', { method: 'POST', body: input, signal })).cards
}
