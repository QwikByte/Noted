'use client'
// Abmelden: Sitzung beenden und alles entfernen, was das Konto auf dem Gerät hinterlassen hat
// (Entwürfe, Lernfortschritte, Offline-Caches).
import { api, clearCachedData } from '@/shared/client/api'
import { sync } from '@/features/notes/client/sync'
import { reviewQueue } from '@/features/flashcards/client/flashcards'
import { focusSessions, GOAL_KEY, SUBJECT_KEY } from '@/features/focus/client/sessions'
import { pdfAnnotations } from '@/features/pdf/client/annotations'

export async function logout() {
  // Noch nicht gesendete Lernfortschritte, Fokus-Runden und PDF-Anmerkungen möglichst mitnehmen
  await Promise.all([reviewQueue.flush(), focusSessions.flush(), pdfAnnotations.flush()])
  try {
    await api('/api/auth/logout', { method: 'POST' })
  } catch {
    /* auch offline lokal abmelden */
  }
  sync.clearAll()
  reviewQueue.clearAll()
  focusSessions.clearAll()
  pdfAnnotations.clearAll()
  // Zuletzt geöffnetes PDF und Lesepositionen gehören zum Konto
  for (const key of ['noted:pdf', 'noted:pdfpos', 'noted:lastDeck', SUBJECT_KEY, GOAL_KEY]) localStorage.removeItem(key)
  await clearCachedData()
  location.href = '/login'
}

/** Abmelden – fragt nach, wenn noch Änderungen auf die Synchronisierung warten. */
export async function confirmLogout() {
  if (sync.hasPending() && !confirm('Es gibt noch nicht synchronisierte Änderungen. Beim Abmelden gehen sie verloren. Trotzdem abmelden?')) {
    return
  }
  await logout()
}
