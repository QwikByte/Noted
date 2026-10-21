'use client'
// Startseite: Nach einer Vorlesung mit Mitschrift, aus der noch keine Karten stammen, an Karteikarten erinnern.
// Wegklicken gilt pro Termin und nur auf diesem Gerät – am nächsten Tag ist die Liste ohnehin leer.
import { useMemo } from 'react'
import { Layers, X } from 'lucide-react'
import { useApp } from '../client/context'
import { useEvents } from '@/features/calendar/client/calendar'
import { endedToday, noteTitleFor } from '@/features/calendar/agenda'
import { dateOf, localDateTime } from '@/features/calendar/dates'
import { useFlashcards } from '@/features/flashcards/client/flashcards'
import { useNotes } from '@/features/notes/client/queries'
import { sync } from '@/features/notes/client/sync'
import { noteText } from '@/features/notes/format'
import type { Note, NoteSummary } from '@/features/notes/types'
import { api, errorMessage } from '@/shared/client/api'
import { useNow } from '@/shared/client/now'
import { usePref } from '@/shared/client/prefs'
import { Button } from '@/shared/ui/button'
import { useToast } from '@/shared/ui/toast'

type Dismissed = { date: string; keys: string[] }

function readDismissed(raw: string, today: string): string[] {
  try {
    const v = JSON.parse(raw) as Partial<Dismissed>
    return v.date === today && Array.isArray(v.keys) ? v.keys : []
  } catch {
    return []
  }
}

export function LectureCardsHint() {
  const app = useApp()
  const toast = useToast()
  const { data: events } = useEvents()
  const { data: flashcards } = useFlashcards()
  const { notes } = useNotes()
  const now = useNow()
  const nowLocal = localDateTime(new Date(now))
  const today = dateOf(nowLocal)
  const [stored, setStored] = usePref<string>('noted:lecture-hints', '')
  const dismissed = readDismissed(stored, today)

  const byTitle = useMemo(() => new Map(notes.map((n) => [n.title.toLowerCase(), n])), [notes])
  const withCards = useMemo(() => new Set(flashcards?.cards.map((c) => c.noteId)), [flashcards])
  const hints =
    events && flashcards
      ? endedToday(events, nowLocal)
          .map((o) => ({ key: `${o.event.id}:${o.date}`, title: o.event.title, note: byTitle.get(noteTitleFor(o).toLowerCase()) }))
          .filter((h): h is typeof h & { note: NoteSummary } => !!h.note && !withCards.has(h.note.id))
      : []

  const visible = hints.filter((h) => !dismissed.includes(h.key))
  if (visible.length === 0) return null

  const dismiss = (key: string) => setStored(JSON.stringify({ date: today, keys: [...dismissed, key] } satisfies Dismissed))

  async function createCards(note: NoteSummary) {
    try {
      // Noch nicht synchronisierte Änderungen zählen mit
      const draft = sync.getDraft(note.id)
      const full =
        draft?.content !== undefined
          ? { content: draft.content, format: draft.format ?? note.format }
          : (await api<{ note: Note }>(`/api/notes/${note.id}`)).note
      app.openCardsFromNote({ id: note.id, title: note.title, content: noteText(full.format, full.content) })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="mb-4 space-y-2" data-testid="lecture-hints">
      {visible.map((h) => (
        <div key={h.key} className="flex items-center gap-3 rounded-xl border border-border bg-elevated px-4 py-3">
          <Layers className="size-5 shrink-0 text-accent-text" />
          <p className="min-w-0 flex-1 text-sm break-words">
            <span className="font-medium">{h.title}</span> ist vorbei. Karteikarten aus der Mitschrift erstellen?
          </p>
          <Button size="sm" variant="primary" onClick={() => void createCards(h.note)}>
            Karten erstellen
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => dismiss(h.key)} aria-label="Hinweis ausblenden" title="Ausblenden">
            <X className="size-4" />
          </Button>
        </div>
      ))}
    </div>
  )
}
