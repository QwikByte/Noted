'use client'
import { useMemo, useState } from 'react'
import { FilePlus2, FileText, Loader2, Plus } from 'lucide-react'
import { useApp } from '@/features/workspace/client/context'
import { useNotes } from '@/features/notes/client/queries'
import { Button } from '@/shared/ui/button'
import { Panel } from '@/shared/ui/panel'
import { useNow } from '@/shared/client/now'
import { dayLabel, groupByDay, noteTitleFor, timeLabel, type AgendaDay } from '../agenda'
import { addMinutes, localDate } from '../dates'
import { blankEvent } from '../event'
import { useEvents } from '../client/calendar'
import { EventDialog, ExamMark, eventColor, type DialogTarget } from './EventDialog'
import type { Occurrence } from '../types'

const DAYS = 7

/** Termine heute und in den nächsten Tagen – mit Mitschrift zum Termin. Offline ohne geladene Termine: nichts. */
export function Agenda({ className }: { className?: string }) {
  const app = useApp()
  const { data: events, isLoading } = useEvents()
  const now = new Date(useNow())
  const today = localDate(now)
  const [dialog, setDialog] = useState<DialogTarget | null>(null)

  if (!events) {
    return isLoading ? (
      <Panel title="Termine" className={className}>
        <Loader2 className="mx-auto size-5 animate-spin text-faint" />
      </Panel>
    ) : null
  }

  const days = groupByDay(events, today, DAYS)
  const addEvent = () =>
    setDialog({ kind: 'new', input: blankEvent(addMinutes(`${today}T00:00`, (now.getHours() + 1) * 60)) })

  return (
    <Panel
      title="Termine"
      className={className}
      testId="agenda"
      actions={
        <>
          <Button variant="ghost" size="icon-sm" onClick={addEvent} aria-label="Termin anlegen" title="Termin anlegen">
            <Plus className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => app.go({ kind: 'calendar' })}>
            Kalender
          </Button>
        </>
      }
    >
      {events.length === 0 ? (
        <p className="text-sm text-muted">Noch keine Termine.</p>
      ) : days.every((d) => d.items.length === 0) ? (
        <p className="text-sm text-muted">In den nächsten {DAYS} Tagen stehen keine Termine an.</p>
      ) : (
        <Days days={days} today={today} onOpen={(occurrence) => setDialog({ kind: 'edit', occurrence })} />
      )}
      {dialog ? <EventDialog target={dialog} onClose={() => setDialog(null)} /> : null}
    </Panel>
  )
}

function Days({ days, today, onOpen }: { days: AgendaDay[]; today: string; onOpen: (o: Occurrence) => void }) {
  const app = useApp()
  const { notes } = useNotes()
  const byTitle = useMemo(() => new Map(notes.map((n) => [n.title.toLowerCase(), n])), [notes])

  return (
    <div className="space-y-4">
      {days.map((day) => (
        <div key={day.date}>
          <h3 className="mb-1 text-sm font-semibold text-muted">{dayLabel(day.date, today)}</h3>
          {day.items.length === 0 ? (
            <p className="text-sm text-muted">Keine Termine.</p>
          ) : (
            <ul className="divide-y divide-border">
              {day.items.map((o) => {
                const title = noteTitleFor(o)
                const note = byTitle.get(title.toLowerCase())
                return (
                  <li key={`${day.date}-${o.event.id}-${o.date}`} className="flex items-center gap-3 py-1.5" data-testid="agenda-event">
                    <button type="button" onClick={() => onOpen(o)} className="flex min-w-0 flex-1 items-center gap-3 rounded-md py-0.5 text-left">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: eventColor(o.event.color) }} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-xs text-muted tabular-nums">{timeLabel(o, day.date)}</span>
                          <span className="truncate text-sm font-medium">
                            <ExamMark event={o.event} />
                            {o.event.title}
                          </span>
                        </span>
                        {o.event.location ? <span className="block truncate text-xs text-muted">{o.event.location}</span> : null}
                      </span>
                    </button>
                    {/* Mitschrift nur für Termine mit Uhrzeit – bei ganztägigen (Feiertag, Exkursion) passt sie selten */}
                    {o.event.allDay ? null : note ? (
                      <Button size="sm" variant="ghost" onClick={() => app.go({ kind: 'note', id: note.id })} title={note.title}>
                        <FileText className="size-4" /> Öffnen
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => app.openNewNote({ templateId: 'lecture', title })} title={`Mitschrift „${title}“ anlegen`}>
                        <FilePlus2 className="size-4" /> Mitschrift
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ))}
    </div>
  )
}
