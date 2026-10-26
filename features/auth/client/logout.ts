'use client'
// Abmelden: Sitzung beenden und alles entfernen, was das Konto auf dem Gerät hinterlassen hat
// (Entwürfe, Lernfortschritte, Schmierzettel, Offline-Caches).
import { api, clearCachedData } from '@/shared/client/api'
import { sync } from '@/features/notes/client/sync'
import { reviewQueue } from '@/features/flashcards/client/flashcards'
import { focusSessions, GOAL_KEY, SUBJECT_KEY } from '@/features/focus/client/sessions'
import { pdfAnnotations } from '@/features/pdf/client/annotations'
import { OFFLINE_KEY, OPENED_KEY } from '@/features/pdf/client/offline'
import { scratchpad } from '@/features/scratchpad/client/scratchpad'
import { vault } from '@/features/vault/client/vault'

export async function logout() {
  // Tresor zuerst sperren – auch in den anderen Tabs
  await vault.lock()
  // Noch nicht gesendete Lernfortschritte, Fokus-Runden, PDF-Anmerkungen und den Schmierzettel möglichst mitnehmen
  await Promise.all([reviewQueue.flush(), focusSessions.flush(), pdfAnnotations.flush(), scratchpad.flush()])
  try {
    await api('/api/auth/logout', { method: 'POST' })
  } catch {
    /* auch offline lokal abmelden */
  }
  sync.clearAll()
  reviewQueue.clearAll()
  focusSessions.clearAll()
  pdfAnnotations.clearAll()
  scratchpad.clearAll()
  // Zuletzt geöffnetes PDF und Lesepositionen gehören zum Konto
  for (const key of ['noted:pdf', 'noted:pdfpos', OFFLINE_KEY, OPENED_KEY, 'noted:lastDeck', SUBJECT_KEY, GOAL_KEY]) {
    localStorage.removeItem(key)
  }
  await clearCachedData()
  location.href = '/login'
}

/** Abmelden – fragt nach, wenn noch Änderungen auf die Synchronisierung warten. */
export async function confirmLogout() {
  const pending = sync.hasPending() || scratchpad.hasPending() || pdfAnnotations.hasPending()
  if (pending && !confirm('Es gibt noch nicht synchronisierte Änderungen. Beim Abmelden gehen sie verloren. Trotzdem abmelden?')) {
    return
  }
  await logout()
}
