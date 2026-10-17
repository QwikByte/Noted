'use client'
import { useMemo } from 'react'
import { CalendarDays, FilePlus2, FileText, Loader2, RefreshCw, Video } from 'lucide-react'
import { useApp } from '@/features/workspace/client/context'
import { useNotes } from '@/features/notes/client/queries'
import { Button } from '@/shared/ui/button'
import { Panel } from '@/shared/ui/panel'
import { useToast } from '@/shared/ui/toast'
import { ApiError, NetworkError, errorMessage } from '@/shared/client/api'
import { useNow } from '@/shared/client/now'
import { agendaRange, dayLabel, groupByDay, noteTitleFor, timeLabel } from '../agenda'
import { connectCalendar, useCalendarEvents, useCalendarStatus } from '../client/calendar'
import type { CalendarEvent } from '../types'

const DAYS = 7

/** Termine heute und in den nächsten Tagen – mit Mitschrift zum Termin. Ohne eingerichteten Kalender: nichts. */
export function Agenda({ className }: { className?: string }) {
  const status = useCalendarStatus()
  const toast = useToast()
  const nowMs = useNow()
  const now = new Date(nowMs)
  const s = status.data
  const usable = s?.connected === true && !s.error
  const events = useCalendarEvents(agendaRange(now, DAYS), usable)

  const connect = () => connectCalendar().catch((err) => toast.error(errorMessage(err)))

  if (!s || !s.configured) {
    return status.isLoading ? (
      <Panel icon={<CalendarDays />} title="Termine" className={className}>
        <Loader2 className="mx-auto size-5 animate-spin text-faint" />
      </Panel>
    ) : null
  }

  if (!s.connected) {
    return (
      <Panel icon={<CalendarDays />} title="Termine" className={className} testId="agenda">
        <p className="mb-3 text-sm text-muted">
          Verbinde deinen Microsoft-Kalender (Outlook): Dann siehst du hier deine Termine und legst die Mitschrift zur
          Vorlesung mit einem Klick an.
        </p>
        <Button variant="primary" size="sm" onClick={connect}>
          <CalendarDays className="size-4" /> Mit Microsoft verbinden
        </Button>
      </Panel>
    )
  }

  const reconnectNeeded = s.error ?? (events.error instanceof ApiError && events.error.code === 'calendar_reconnect' ? events.error.message : null)
  return (
    <Panel icon={<CalendarDays />} title="Termine" className={className} testId="agenda">
      {reconnectNeeded ? (
        <div className="space-y-3">
          <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">{reconnectNeeded}</p>
          <Button size="sm" onClick={connect}>
            <RefreshCw className="size-4" /> Neu verbinden
          </Button>
        </div>
      ) : events.isLoading ? (
        <Loader2 className="mx-auto size-5 animate-spin text-faint" />
      ) : events.error ? (
        <p className="text-sm text-muted">
          {events.error instanceof NetworkError ? 'Offline – die Termine sind gerade nicht verfügbar.' : errorMessage(events.error)}
        </p>
      ) : (
        <Days events={events.data ?? []} now={now} />
      )}
    </Panel>
  )
}

function Days({ events, now }: { events: CalendarEvent[]; now: Date }) {
  const app = useApp()
  const { notes } = useNotes()
  const byTitle = useMemo(() => new Map(notes.map((n) => [n.title.toLowerCase(), n])), [notes])
  const days = groupByDay(events, now, DAYS)
  if (days.every((d) => d.events.length === 0)) {
    return <p className="text-sm text-muted">In den nächsten {DAYS} Tagen stehen keine Termine an.</p>
  }

  return (
    <div className="space-y-4">
      {days.map((day) => (
        <div key={day.key}>
          <h3 className="mb-1 text-xs font-semibold tracking-wide text-faint uppercase">{dayLabel(day.date, now)}</h3>
          {day.events.length === 0 ? (
            <p className="text-sm text-muted">Keine Termine.</p>
          ) : (
            <ul className="divide-y divide-border">
              {day.events.map((ev) => {
                const title = noteTitleFor(ev, day.date)
                const note = byTitle.get(title.toLowerCase())
                return (
                  <li key={`${day.key}-${ev.id}`} className="flex items-center gap-3 py-2" data-testid="agenda-event">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: ev.color ?? 'var(--accent)' }} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-xs text-muted tabular-nums">{timeLabel(ev, day.date)}</span>
                        <span className="truncate text-sm font-medium">{ev.subject}</span>
                      </div>
                      {ev.location ? <div className="truncate text-xs text-muted">{ev.location}</div> : null}
                    </div>
                    {ev.joinUrl ? (
                      <a
                        href={ev.joinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`${ev.subject}: online teilnehmen`}
                        title="Online teilnehmen"
                        className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg"
                      >
                        <Video className="size-4" />
                      </a>
                    ) : null}
                    {/* Mitschrift nur für Termine mit Uhrzeit – bei ganztägigen (Feiertag, Exkursion) passt sie selten */}
                    {ev.allDay ? null : note ? (
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
