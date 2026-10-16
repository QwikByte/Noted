'use client'
import { api, clearCachedData } from './api'
import { sync } from './sync'
import { reviewQueue } from './flashcards'

export async function logout() {
  // Noch nicht gesendete Lernfortschritte möglichst mitnehmen
  await reviewQueue.flush()
  try {
    await api('/api/auth/logout', { method: 'POST' })
  } catch {
    /* auch offline lokal abmelden */
  }
  sync.clearAll()
  reviewQueue.clearAll()
  // Zuletzt geöffnetes PDF und Lesepositionen gehören zum Konto
  for (const key of ['noted:pdf', 'noted:pdfpos', 'noted:lastDeck']) localStorage.removeItem(key)
  await clearCachedData()
  location.href = '/login'
}
