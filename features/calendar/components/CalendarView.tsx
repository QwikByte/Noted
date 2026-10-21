'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, CloudOff, Download, Loader2, MoreVertical, Plus, Upload } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Menu, MenuItem } from '@/shared/ui/menu'
import { useToast } from '@/shared/ui/toast'
import { cn } from '@/shared/ui/cn'
import { NetworkError, errorMessage } from '@/shared/client/api'
import { useMediaQuery } from '@/shared/client/media'
import { useNow } from '@/shared/client/now'
import { usePref } from '@/shared/client/prefs'
import { timeLabel } from '../agenda'
import {
  addDays,
  addMinutes,
  addMonths,
  isoWeek,
  localDate,
  longDate,
  monthName,
  startOfMonth,
  startOfWeek,
  timeOf,
  weekdayName,
  weekdayShort,
} from '../dates'
import { blankEvent, occurrences, onDay } from '../event'
import { layoutDay } from '../layout'
import { useEventMutations, useEvents, type ImportSummary } from '../client/calendar'
import { EventDialog, ExamMark, eventColor, type DialogTarget } from './EventDialog'
import type { CalendarEvent, Occurrence } from '../types'

/** Höhe einer Stunde im Wochenraster in px */
const HOUR = 48
/** So viele Termine passen in ein Feld der Monatsansicht */
const MONTH_CHIPS = 3

type Mode = 'week' | 'month'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function importMessage(r: ImportSummary): string {
  const parts = [`${plural(r.created, 'Termin', 'Termine')} importiert`]
  if (r.duplicates) parts.push(`${r.duplicates} schon vorhanden`)
  if (r.skipped) parts.push(`${r.skipped} übersprungen`)
  let text = parts.join(', ') + '.'
  if (r.simplified) {
    text += ` Bei ${plural(r.simplified, 'Serie', 'Serien')} wiederholt Noted nur wöchentlich – übernommen wurde der erste Termin.`
  }
  return text
}

export function CalendarView() {
  const { data: events, isLoading, error } = useEvents()
  const toast = useToast()
  const m = useEventMutations()
  const nowMs = useNow()
  const now = new Date(nowMs)
  const today = localDate(now)
  // Auf dem Handy zeigt die Woche einen Tag – gewischt wird von Tag zu Tag
  const wide = useMediaQuery('(min-width: 768px)')
  const [mode, setMode] = usePref<Mode>('noted:calendarView', 'week')
  const [anchor, setAnchor] = useState(today)
  const [dialog, setDialog] = useState<DialogTarget | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const touch = useRef<{ x: number; y: number } | null>(null)

  // Waagerechtes Wischen blättert hier die Tage – sonst wertet der Browser es zusätzlich als „Zurück“ und verlässt
  // den Kalender. Abschalten lässt sich das nur an der Wurzel, daher nur, solange die schmale Ansicht offen ist.
  useEffect(() => {
    if (wide) return
    const root = document.documentElement
    root.style.overscrollBehaviorX = 'none'
    return () => {
      root.style.overscrollBehaviorX = ''
    }
  }, [wide])

  const days = useMemo(
    () => (wide ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i)) : [anchor]),
    [wide, anchor],
  )
  const month = startOfMonth(anchor)

  const step = (dir: 1 | -1) => setAnchor(mode === 'month' ? addMonths(anchor, dir) : addDays(anchor, dir * days.length))
  const showDay = (date: string) => {
    setMode('week')
    setAnchor(date)
  }

  /** Neuer Termin – heute zur nächsten vollen Stunde, an anderen Tagen um 9 Uhr */
  const openNew = (date: string, minutes?: number) => {
    const at = minutes ?? (date === today ? (now.getHours() + 1) * 60 : 9 * 60)
    setDialog({ kind: 'new', input: blankEvent(addMinutes(`${date}T00:00`, at)) })
  }
  const visibleToday = mode === 'month' ? today.slice(0, 7) === month.slice(0, 7) : days.includes(today)
  const newDate = visibleToday ? today : mode === 'month' ? month : days[0]

  async function runImport(file: File) {
    try {
      toast.show(importMessage(await m.importFile.mutateAsync(file)), { tone: 'success', duration: 6000 })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const unit = mode === 'month' ? 'Einen Monat' : wide ? 'Eine Woche' : 'Einen Tag'
  let label: string
  if (mode === 'month') label = `${monthName(month)} ${month.slice(0, 4)}`
  else if (!wide) label = `${weekdayName(anchor)}, ${longDate(anchor)}`
  else {
    const first = days[0]
    const last = days[6]
    label =
      first.slice(0, 7) === last.slice(0, 7)
        ? `${monthName(first)} ${first.slice(0, 4)}`
        : `${monthName(first)} – ${monthName(last)} ${last.slice(0, 4)}`
  }

  return (
    <div className="flex h-full flex-col px-3 pt-4 pb-16 sm:px-6 sm:pt-6" data-testid="calendar">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {/* Beim Blättern wird der neue Zeitraum vorgelesen – mit KW, die sich innerhalb eines Monats als Einziges ändert */}
        <h1 className="mr-auto flex min-w-0 items-baseline gap-2.5 text-xl font-bold tracking-tight sm:text-2xl" aria-live="polite" aria-atomic="true">
          <span className="truncate" data-testid="calendar-label">
            {label}
          </span>
          {mode === 'week' ? <span className="shrink-0 text-sm font-medium text-faint">KW {isoWeek(days[0])}</span> : null}
        </h1>
        {/* Auf dem Handy stehen die Knöpfe in einer eigenen Zeile unter dem Titel */}
        <div className="order-last flex w-full items-center gap-1 sm:order-none sm:w-auto">
          <Button size="sm" onClick={() => setAnchor(today)} disabled={visibleToday}>
            Heute
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => step(-1)} aria-label={`${unit} zurück`}>
            <ChevronLeft className="size-4.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => step(1)} aria-label={`${unit} weiter`}>
            <ChevronRight className="size-4.5" />
          </Button>
          <div className="ml-auto flex rounded-lg bg-subtle p-0.5 sm:ml-1" role="radiogroup" aria-label="Ansicht">
            {(
              [
                ['week', wide ? 'Woche' : 'Tag'],
                ['month', 'Monat'],
              ] as const
            ).map(([value, text]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                onClick={() => setMode(value)}
                className={cn(
                  'rounded-md px-3 py-1 text-sm font-medium transition-colors',
                  mode === value ? 'bg-elevated text-fg shadow-sm' : 'text-muted hover:text-fg',
                )}
              >
                {text}
              </button>
            ))}
          </div>
          <Button variant="primary" size="sm" className="ml-1" onClick={() => openNew(newDate)}>
            <Plus className="size-4" /> <span className="max-sm:hidden">Neuer</span> Termin
          </Button>
        </div>
        <Menu
          trigger={(p) => (
            <Button variant="ghost" size="icon-sm" aria-label="Weitere Aktionen" {...p}>
              <MoreVertical className="size-4.5" />
            </Button>
          )}
        >
          <MenuItem icon={<Upload />} onSelect={() => fileInput.current?.click()} disabled={m.importFile.isPending}>
            .ics importieren
          </MenuItem>
          <MenuItem icon={<Download />} onSelect={() => window.location.assign('/api/calendar/export')}>
            Als .ics exportieren
          </MenuItem>
        </Menu>
        <input
          ref={fileInput}
          type="file"
          accept=".ics,text/calendar"
          hidden
          data-testid="ics-input"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void runImport(file)
          }}
        />
      </div>

      {isLoading ? (
        <Loader2 className="mx-auto mt-10 size-6 animate-spin text-faint" />
      ) : !events ? (
        <div className="flex items-center gap-2 rounded-lg border border-border p-4 text-sm text-muted">
          <CloudOff className="size-4" />
          {error instanceof NetworkError ? 'Offline – der Kalender wurde auf diesem Gerät noch nicht geladen.' : 'Der Kalender konnte nicht geladen werden.'}
        </div>
      ) : (
        <>
          <div
            className="flex min-h-0 flex-1 flex-col"
            onTouchStart={(e) => {
              const t = e.touches[0]
              touch.current = { x: t.clientX, y: t.clientY }
            }}
            onTouchEnd={(e) => {
              const start = touch.current
              touch.current = null
              if (!start || wide) return
              const t = e.changedTouches[0]
              const dx = t.clientX - start.x
              if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(t.clientY - start.y)) step(dx < 0 ? 1 : -1)
            }}
          >
            {mode === 'week' ? (
              <WeekView
                days={days}
                events={events}
                today={today}
                nowMinutes={now.getHours() * 60 + now.getMinutes()}
                onSlot={openNew}
                onOpen={(occurrence) => setDialog({ kind: 'edit', occurrence })}
              />
            ) : (
              <MonthView
                month={month}
                events={events}
                today={today}
                wide={wide}
                onDay={showDay}
                onSlot={(date) => openNew(date)}
                onOpen={(occurrence) => setDialog({ kind: 'edit', occurrence })}
              />
            )}
          </div>
        </>
      )}

      {dialog ? <EventDialog target={dialog} onClose={() => setDialog(null)} /> : null}
    </div>
  )
}

function WeekView({
  days,
  events,
  today,
  nowMinutes,
  onSlot,
  onOpen,
}: {
  days: string[]
  events: CalendarEvent[]
  today: string
  nowMinutes: number
  onSlot: (date: string, minutes: number) => void
  onOpen: (o: Occurrence) => void
}) {
  const items = useMemo(() => occurrences(events, days[0], addDays(days[days.length - 1], 1)), [events, days])
  const allDay = days.map((d) => items.filter((o) => o.event.allDay && onDay(o, d)))
  const scroller = useRef<HTMLDivElement>(null)
  // Beim Öffnen auf den Morgen bzw. kurz vor jetzt scrollen – danach bleibt die Position beim Blättern
  const [initialTop] = useState(() => Math.max(0, (days.includes(today) ? nowMinutes / 60 - 1.5 : 7) * HOUR))
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = initialTop
  }, [initialTop])

  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-elevated">
      <div className="sticky top-0 z-10 border-b border-border bg-elevated">
        {days.length > 1 ? (
          <div className="flex">
            <div className="w-12 shrink-0" />
            {days.map((d) => (
              <div key={d} className="min-w-0 flex-1 border-l border-border py-1.5 text-center">
                <div className="text-xs text-muted">{weekdayShort(d)}</div>
                <div
                  className={cn(
                    'mx-auto flex size-7 items-center justify-center rounded-full text-sm font-semibold tabular-nums',
                    d === today && 'bg-accent text-on-accent',
                  )}
                >
                  {Number(d.slice(8))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {allDay.some((list) => list.length > 0) ? (
          <div className={cn('flex', days.length > 1 && 'border-t border-border')}>
            <div className="w-12 shrink-0 px-1 py-1.5 text-right text-[10px] leading-tight text-faint">ganz&shy;tägig</div>
            {days.map((d, i) => (
              <div key={d} className="min-w-0 flex-1 space-y-0.5 border-l border-border p-0.5">
                {allDay[i].map((o) => (
                  <button
                    key={`${o.event.id}-${o.date}`}
                    type="button"
                    onClick={() => onOpen(o)}
                    className="block w-full truncate rounded px-1.5 text-left text-xs leading-5 font-medium hover:brightness-95"
                    style={{ background: `color-mix(in srgb, ${eventColor(o.event.color)} 22%, var(--bg-elevated))` }}
                    data-testid="calendar-event"
                  >
                    <ExamMark event={o.event} />
                    {o.event.title}
                  </button>
                ))}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div
        className="relative flex"
        style={{
          height: 24 * HOUR,
          backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0 1px, transparent 1px ${HOUR}px)`,
        }}
      >
        <div className="relative w-12 shrink-0 bg-elevated">
          {Array.from({ length: 23 }, (_, i) => (
            <span key={i} className="absolute right-1.5 text-[11px] text-faint tabular-nums" style={{ top: (i + 1) * HOUR - 7 }}>
              {String(i + 1).padStart(2, '0')}:00
            </span>
          ))}
        </div>
        {days.map((d) => (
          <div
            key={d}
            className="relative min-w-0 flex-1 cursor-pointer border-l border-border"
            data-testid={`day-${d}`}
            onClick={(e) => {
              // Klick ins Raster: neuer Termin zur angeklickten halben Stunde
              const y = e.clientY - e.currentTarget.getBoundingClientRect().top
              onSlot(d, Math.min(23 * 60 + 30, Math.max(0, Math.floor((y / HOUR) * 2) * 30)))
            }}
          >
            {layoutDay(items, d).map((p) => {
              const o = p.occurrence
              const color = eventColor(o.event.color)
              const height = Math.max(16, (p.height / 60) * HOUR - 2)
              // Kurz vor Mitternacht bleibt der Termin ganz im Raster
              const top = Math.min((p.top / 60) * HOUR + 1, 24 * HOUR - height - 1)
              const details = `${timeLabel(o, d)}${o.event.location ? ` · ${o.event.location}` : ''}`
              return (
                <button
                  key={`${o.event.id}-${o.date}`}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpen(o)
                  }}
                  className="absolute overflow-hidden rounded-md px-1.5 py-0.5 text-left text-xs leading-tight shadow-sm hover:brightness-95"
                  style={{
                    top,
                    height,
                    left: `calc(${(p.column / p.columns) * 100}% + 2px)`,
                    width: `calc(${100 / p.columns}% - 4px)`,
                    background: `color-mix(in srgb, ${color} 16%, var(--bg-elevated))`,
                    borderLeft: `3px solid ${color}`,
                  }}
                  title={`${o.event.title}\n${details}`}
                  data-testid="calendar-event"
                >
                  {height >= 34 ? (
                    <>
                      <span className="block truncate font-medium">
                        <ExamMark event={o.event} />
                        {o.event.title}
                      </span>
                      <span className="block truncate text-muted">{details}</span>
                    </>
                  ) : (
                    // Kurze Termine: alles in einer Zeile
                    <span className="block truncate">
                      <span className="font-medium">
                        <ExamMark event={o.event} />
                        {o.event.title}
                      </span>{' '}
                      <span className="text-muted">{timeLabel(o, d)}</span>
                    </span>
                  )}
                </button>
              )
            })}
            {d === today ? (
              <div className="pointer-events-none absolute inset-x-0 z-[1] h-0.5 bg-danger" style={{ top: (nowMinutes / 60) * HOUR }}>
                <span className="absolute -top-1 -left-1 size-2.5 rounded-full bg-danger" />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

function MonthView({
  month,
  events,
  today,
  wide,
  onDay: showDay,
  onSlot,
  onOpen,
}: {
  month: string
  events: CalendarEvent[]
  today: string
  wide: boolean
  onDay: (date: string) => void
  onSlot: (date: string) => void
  onOpen: (o: Occurrence) => void
}) {
  const cells = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(startOfWeek(month), i)), [month])
  const items = useMemo(() => occurrences(events, cells[0], addDays(cells[41], 1)), [events, cells])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-border">
      <div className="grid grid-cols-7 gap-px border-b border-border">
        {cells.slice(0, 7).map((d) => (
          <div key={d} className="bg-elevated py-1.5 text-center text-xs text-muted">
            {weekdayShort(d)}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-px">
        {cells.map((d) => {
          const list = items.filter((o) => onDay(o, d))
          const outside = d.slice(0, 7) !== month.slice(0, 7)
          return (
            <div
              key={d}
              className={cn('min-h-16 min-w-0 cursor-pointer overflow-hidden p-1', outside ? 'bg-subtle' : 'bg-elevated')}
              data-testid={`month-${d}`}
              // Auf dem Handy sind die Felder zu klein für Termine – ein Tipp zeigt den Tag
              onClick={() => (wide ? onSlot(d) : showDay(d))}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  showDay(d)
                }}
                // Auf dem Handy stehen die Termine nur als Punkte da – die Anzahl gibt es so auch zum Vorlesen
                aria-label={`${weekdayName(d)}, ${longDate(d)}${list.length ? `, ${plural(list.length, 'Termin', 'Termine')}` : ''}`}
                className={cn(
                  'flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                  d === today ? 'bg-accent text-on-accent' : outside ? 'text-faint hover:bg-hover' : 'hover:bg-hover',
                )}
              >
                {Number(d.slice(8))}
              </button>
              {wide ? (
                <div className="mt-0.5 space-y-px">
                  {list.slice(0, MONTH_CHIPS).map((o) => (
                    <MonthChip key={`${o.event.id}-${o.date}`} occurrence={o} day={d} onOpen={onOpen} />
                  ))}
                  {list.length > MONTH_CHIPS ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        showDay(d)
                      }}
                      className="block w-full truncate rounded px-1 text-left text-[11px] leading-5 font-medium text-muted hover:bg-hover"
                    >
                      +{list.length - MONTH_CHIPS} weitere
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="mt-1 flex flex-wrap gap-0.5 px-0.5">
                  {list.slice(0, 6).map((o) => (
                    <span
                      key={`${o.event.id}-${o.date}`}
                      className="size-1.5 rounded-full"
                      style={{ background: eventColor(o.event.color) }}
                      aria-hidden
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MonthChip({ occurrence: o, day, onOpen }: { occurrence: Occurrence; day: string; onOpen: (o: Occurrence) => void }) {
  const color = eventColor(o.event.color)
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onOpen(o)
      }}
      className="flex w-full min-w-0 items-center gap-1 rounded px-1 text-left text-[11px] leading-5 hover:bg-hover"
      style={o.event.allDay ? { background: `color-mix(in srgb, ${color} 22%, var(--bg-elevated))` } : undefined}
      data-testid="calendar-event"
    >
      {o.event.allDay ? null : (
        <>
          <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
          {o.start.startsWith(day) ? <span className="shrink-0 text-muted tabular-nums">{timeOf(o.start)}</span> : null}
        </>
      )}
      <span className="truncate font-medium">
        <ExamMark event={o.event} />
        {o.event.title}
      </span>
    </button>
  )
}
