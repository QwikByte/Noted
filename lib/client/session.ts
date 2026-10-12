'use client'
import { api, clearCachedData } from './api'
import { sync } from './sync'

/** Offline-Caches des Service Workers leeren (beim Ab- und Anmelden), damit keine fremden Daten übrig bleiben. */
export const clearOfflineCaches = clearCachedData

export async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST' })
  } catch {
    /* auch offline lokal abmelden */
  }
  sync.clearAll()
  await clearOfflineCaches()
  location.href = '/login'
}
