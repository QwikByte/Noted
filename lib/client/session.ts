'use client'
import { api } from './api'
import { sync } from './sync'

/** Offline-Caches des Service Workers leeren (beim Ab- und Anmelden), damit keine fremden Daten übrig bleiben. */
export async function clearOfflineCaches() {
  try {
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k.startsWith('noted-data') || k.startsWith('noted-shell')).map((k) => caches.delete(k)))
    }
  } catch {
    /* egal */
  }
}

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
