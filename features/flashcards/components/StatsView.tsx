'use client'
// Lernstatistik: Kennzahlen, Lerntage als Heatmap, fällige Karten der nächsten Tage und Trefferquote je Stapel
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarRange, ChartColumn, ChevronRight, Download, Flame, Layers, MoreVertical, Timer } from 'lucide-react'
import { useApp } from '@/features/workspace/client/context'
import { Page, PageHeader } from '@/shared/ui/page-layout'
import { Panel } from '@/shared/ui/panel'
import { Button } from '@/shared/ui/button'
import { Menu, MenuItem } from '@/shared/ui/menu'
import { cn } from '@/shared/ui/cn'
import { api, errorMessage } from '@/shared/client/api'
import { useNow } from '@/shared/client/now'
import { useFlashcards } from '../client/flashcards'
import { addDays, isoWeek, localDate, shortDate, startOfWeek, weekday, weekdayShort } from '@/features/calendar/dates'
import { useFocusSessions } from '@/features/focus/client/sessions'
import { formatStudyTime, weeklyBySubject } from '@/features/focus/sessions'
import { dueForecast, streaks } from '../stats'
import type { StudyDay, StudyStats } from '../types'

const WEEKS = 53
const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

/** Heatmap: eine Farbe, je mehr Bewertungen desto kräftiger (Stufen nach den Vierteln der Lerntage) */
const LEVEL_COLORS = [
  'color-mix(in srgb, var(--text) 7%, var(--bg-elevated))',
  'color-mix(in srgb, var(--accent) 28%, var(--bg-elevated))',
  'color-mix(in srgb, var(--accent) 52%, var(--bg-elevated))',
  'color-mix(in srgb, var(--accent) 76%, var(--bg-elevated))',
  'var(--accent)',
]

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('de-DE')} ${n === 1 ? one : many}`

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  const min = Math.round(s / 60)
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`
}

export function StatsView() {
  const app = useApp()
  const { data: flashcards } = useFlashcards()
  const now = useNow()
  const today = localDate(new Date(now))
  const { data, isLoading, error } = useQuery({
    queryKey: ['stats'],
    queryFn: () => api<StudyStats>(`/api/stats?tz=${encodeURIComponent(timeZone())}`),
    staleTime: 0,
  })

  return (
    <Page className="max-w-4xl">
      <PageHeader
        breadcrumb={
          <button type="button" onClick={() => app.go({ kind: 'cards' })} className="mb-2 flex items-center gap-1 text-sm text-muted hover:text-fg">
            <Layers className="size-3.5" /> Karteikarten <ChevronRight className="size-3.5" />
          </button>
        }
        icon={<ChartColumn />}
        title="Lernstatistik"
        subtitle={
          data?.since
            ? `${plural(data.total, 'Bewertung', 'Bewertungen')} seit ${new Date(data.since).toLocaleDateString('de-DE')}`
            : 'Wie regelmäßig und wie erfolgreich du lernst – und was als Nächstes ansteht.'
        }
        actions={
          <Menu
            trigger={(p) => (
              <Button variant="ghost" size="icon-sm" aria-label="Statistik-Aktionen" {...p}>
                <MoreVertical className="size-4" />
              </Button>
            )}
          >
            <MenuItem icon={<Download />} onSelect={() => window.location.assign('/api/stats/export')} disabled={!data?.total}>
              Bewertungsprotokoll als CSV
            </MenuItem>
          </Menu>
        }
      />

      {data ? (
        <div className="space-y-5">
          <Figures stats={data} today={today} />
          <Heatmap days={data.days} today={today} />
          {flashcards ? <Forecast now={now} /> : null}
          <DeckTable stats={data} />
          <FocusTime today={today} />
        </div>
      ) : isLoading ? null : (
        <p className="rounded-xl border border-border p-4 text-sm text-muted">
          Die Statistik konnte nicht geladen werden. {errorMessage(error)}
        </p>
      )}
      {!data && flashcards ? <Forecast now={now} className="mt-5" /> : null}
    </Page>
  )
}

function Tile({ label, value, hint, icon }: { label: string; value: string; hint?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-elevated p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 flex items-center gap-1.5 text-3xl font-semibold tracking-tight">
        {icon}
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-faint">{hint}</p> : null}
    </div>
  )
}

function Figures({ stats, today }: { stats: StudyStats; today: string }) {
  const { current, longest } = streaks(
    stats.days.map((d) => d.date),
    today,
  )
  const todayCount = stats.days.find((d) => d.date === today)?.reviews ?? 0
  const recent = stats.decks.reduce(
    (s, d) => ({ reviews: s.reviews + d.reviews, ms: s.ms + d.ms, mature: s.mature + d.matureReviews, correct: s.correct + d.matureCorrect }),
    { reviews: 0, ms: 0, mature: 0, correct: 0 },
  )
  const studyDays = stats.days.filter((d) => d.date > addDays(today, -30)).length
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="stats-figures">
      <Tile label="Heute" value={todayCount.toLocaleString('de-DE')} hint={todayCount === 1 ? 'Bewertung' : 'Bewertungen'} />
      <Tile
        label="Serie"
        value={plural(current, 'Tag', 'Tage')}
        hint={`Längste: ${plural(longest, 'Tag', 'Tage')}`}
        icon={current > 0 ? <Flame className="size-6 text-warning" aria-hidden /> : undefined}
      />
      <Tile
        label="Trefferquote"
        value={recent.mature ? `${Math.round((recent.correct / recent.mature) * 100)} %` : '–'}
        hint="gelernte Karten, 30 Tage"
      />
      <Tile
        label="Zeit pro Karte"
        value={recent.reviews ? formatDuration(recent.ms / recent.reviews) : '–'}
        hint={studyDays ? `Ø ${plural(Math.round(recent.reviews / studyDays), 'Bewertung', 'Bewertungen')} pro Lerntag` : '30 Tage'}
      />
    </div>
  )
}

/** Lerntage der letzten 53 Wochen – Spalten sind Wochen (Montag oben), wie bei GitHub */
function Heatmap({ days, today }: { days: StudyDay[]; today: string }) {
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days])
  // Stufen nach den Vierteln der Lerntage – so bleibt die Karte bei wenig wie bei viel Lernen aussagekräftig
  const thresholds = useMemo(() => {
    const counts = days.map((d) => d.reviews).sort((a, b) => a - b)
    if (counts.length === 0) return [1, 1, 1]
    const q = (p: number) => counts[Math.min(counts.length - 1, Math.floor(p * counts.length))]
    return [q(0.25), q(0.5), q(0.75)]
  }, [days])
  const level = (n: number) => (n === 0 ? 0 : n <= thresholds[0] ? 1 : n <= thresholds[1] ? 2 : n <= thresholds[2] ? 3 : 4)

  const start = addDays(today, -(WEEKS - 1) * 7 - weekday(today))
  const weeks = Array.from({ length: WEEKS }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)))
  const active = days.filter((d) => d.date >= start).length

  return (
    <Panel icon={<CalendarRange />} title="Lerntage" testId="stats-heatmap" actions={<span className="text-sm text-muted">{plural(active, 'Lerntag', 'Lerntage')} im letzten Jahr</span>}>
      {/* Auf schmalen Bildschirmen scrollt die Karte, die jüngsten Wochen stehen rechts */}
      <div className="overflow-x-auto" dir="rtl">
        <div dir="ltr" className="flex w-max gap-[3px] pb-1">
          <div className="mr-1 grid grid-rows-[14px_repeat(7,11px)] gap-[3px] text-[10px] leading-[11px] text-faint">
            <span />
            {weeks[0].map((date, i) => (
              <span key={date}>{i % 2 === 0 ? weekdayShort(date) : ''}</span>
            ))}
          </div>
          {weeks.map((week) => {
            const monthStart = week.find((d) => d.endsWith('-01'))
            return (
              <div key={week[0]} className="grid w-[11px] shrink-0 grid-rows-[14px_repeat(7,11px)] gap-[3px]">
                {/* Monatsname ragt über die Nachbarspalten, ohne die Spalte zu verbreitern */}
                <span className="relative">
                  <span className="absolute top-0 left-0 text-[10px] leading-[14px] whitespace-nowrap text-faint">
                    {monthStart ? MONTHS[Number(monthStart.slice(5, 7)) - 1] : ''}
                  </span>
                </span>
                {week.map((date) => {
                  if (date > today) return <span key={date} />
                  const day = byDate.get(date)
                  const n = day?.reviews ?? 0
                  const label = `${shortDate(date)}: ${n ? `${plural(n, 'Bewertung', 'Bewertungen')}${day?.again ? `, ${day.again}× Nochmal` : ''}` : 'nicht gelernt'}`
                  return (
                    <span
                      key={date}
                      title={label}
                      aria-label={label}
                      role="img"
                      className={cn('size-[11px] rounded-[2px]', date === today && 'ring-1 ring-fg/40')}
                      style={{ background: LEVEL_COLORS[level(n)] }}
                      data-count={n}
                    />
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-1 text-xs text-faint" aria-hidden>
        weniger
        {LEVEL_COLORS.map((c) => (
          <span key={c} className="size-[11px] rounded-[2px]" style={{ background: c }} />
        ))}
        mehr
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-muted hover:text-fg">Letzte 30 Tage als Tabelle</summary>
        <table className="mt-2 w-full text-left tabular-nums">
          <thead className="text-xs text-muted">
            <tr>
              <th className="py-1 font-medium">Tag</th>
              <th className="py-1 text-right font-medium">Bewertungen</th>
              <th className="py-1 text-right font-medium">Nochmal</th>
              <th className="py-1 text-right font-medium">Lernzeit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {Array.from({ length: 30 }, (_, i) => addDays(today, -i))
              .filter((date) => byDate.has(date))
              .map((date) => {
                const d = byDate.get(date)!
                return (
                  <tr key={date}>
                    <td className="py-1">
                      {weekdayShort(date)}, {shortDate(date)}
                    </td>
                    <td className="py-1 text-right">{d.reviews}</td>
                    <td className="py-1 text-right">{d.again}</td>
                    <td className="py-1 text-right">{formatDuration(d.ms)}</td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </details>
    </Panel>
  )
}

/** Fällige Karten der nächsten 7 bzw. 30 Tage als Säulen – eine Reihe, eine Farbe */
function Forecast({ now, className }: { now: number; className?: string }) {
  const { data } = useFlashcards()
  const [range, setRange] = useState<7 | 30>(7)
  const counts = useMemo(() => (data ? dueForecast(data.cards, data.states, now, range) : []), [data, now, range])
  const max = Math.max(1, ...counts)
  const total = counts.reduce((s, n) => s + n, 0)
  const today = localDate(new Date(now))
  const label = (i: number) => {
    const date = addDays(today, i)
    return i === 0 ? 'Heute' : i === 1 ? 'Morgen' : `${weekdayShort(date)}, ${shortDate(date)}`
  }
  const peak = counts.indexOf(Math.max(...counts))

  return (
    <Panel
      icon={<Layers />}
      title="Fällige Karten"
      className={className}
      testId="stats-forecast"
      actions={
        <div className="flex rounded-lg bg-subtle p-0.5" role="radiogroup" aria-label="Zeitraum">
          {([7, 30] as const).map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={range === r}
              onClick={() => setRange(r)}
              className={cn('rounded-md px-2.5 py-1 text-xs font-medium', range === r ? 'bg-elevated text-fg shadow-sm' : 'text-muted hover:text-fg')}
            >
              {r} Tage
            </button>
          ))}
        </div>
      }
    >
      <p className="mb-3 text-sm text-muted">
        {plural(total, 'Wiederholung', 'Wiederholungen')} in {range} Tagen, davon heute {counts[0] ?? 0} – dazu kommen neue Karten nach dem
        Tageslimit der Stapel.
      </p>
      <div className="flex h-40 items-end gap-[2px] border-b border-border" role="list" aria-label="Fällige Karten je Tag">
        {counts.map((n, i) => (
          <div key={i} role="listitem" className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end" title={`${label(i)}: ${n}`}>
            {/* Wert nur am heutigen Tag und an der Spitze – den Rest zeigt der Tooltip */}
            {(i === 0 || i === peak) && n > 0 ? <span className="mb-0.5 text-[11px] text-muted tabular-nums">{n}</span> : null}
            <div
              className="w-full max-w-6 rounded-t bg-accent transition-opacity group-hover:opacity-80"
              style={{ height: `${(n / max) * 100}%`, minHeight: n > 0 ? 2 : 0 }}
              aria-label={`${label(i)}: ${n}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[2px] text-[11px] text-faint">
        {counts.map((_, i) => (
          <span key={i} className="min-w-0 flex-1 truncate text-center">
            {range === 7 ? (i === 0 ? 'Heute' : weekdayShort(addDays(today, i))) : i % 7 === 0 ? (i === 0 ? 'Heute' : shortDate(addDays(today, i))) : ''}
          </span>
        ))}
      </div>
    </Panel>
  )
}

const FOCUS_WEEKS = 4

/** Lernzeit aus gezählten Runden des Fokus-Timers je Fach in den letzten vier Wochen */
function FocusTime({ today }: { today: string }) {
  const { sessions, isLoading } = useFocusSessions()
  const thisWeek = startOfWeek(today)
  const weeks = Array.from({ length: FOCUS_WEEKS }, (_, i) => addDays(thisWeek, -7 * (FOCUS_WEEKS - 1 - i)))
  const rows = weeklyBySubject(sessions, weeks)
  const total = rows.reduce((s, r) => s + r.weeks[FOCUS_WEEKS - 1], 0)
  if (isLoading) return null
  return (
    <Panel
      icon={<Timer />}
      title="Lernzeit mit dem Fokus-Timer"
      testId="stats-focus"
      actions={rows.length ? <span className="text-sm text-muted">Diese Woche: {formatStudyTime(total)}</span> : undefined}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted">
          Noch keine gezählten Runden. Trag im Fokus-Timer ein Fach ein und bestätige nach der Runde, dass sie zählen soll – dann
          siehst du hier, wie viel Zeit in welches Fach geflossen ist.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Fach</th>
                {weeks.map((w, i) => (
                  <th key={w} className="py-1.5 pr-3 text-right font-medium whitespace-nowrap" title={`Woche ab ${shortDate(w)}`}>
                    {i === FOCUS_WEEKS - 1 ? 'Diese Woche' : `KW ${isoWeek(w)}`}
                  </th>
                ))}
                <th className="py-1.5 text-right font-medium">Summe</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border tabular-nums">
              {rows.map((r) => (
                <tr key={r.subject || '–'}>
                  <td className="max-w-48 truncate py-1.5 pr-3">{r.subject || <span className="text-muted">ohne Fach</span>}</td>
                  {r.weeks.map((ms, i) => (
                    <td key={weeks[i]} className="py-1.5 pr-3 text-right whitespace-nowrap">
                      {ms ? formatStudyTime(ms) : '–'}
                    </td>
                  ))}
                  <td className="py-1.5 text-right font-medium whitespace-nowrap">{formatStudyTime(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

function DeckTable({ stats }: { stats: StudyStats }) {
  const { data } = useFlashcards()
  const rows = (data?.decks ?? [])
    .map((deck) => ({ deck, s: stats.decks.find((d) => d.deckId === deck.id) }))
    .sort((a, b) => (b.s?.reviews ?? 0) - (a.s?.reviews ?? 0) || a.deck.name.localeCompare(b.deck.name, 'de'))
  if (rows.length === 0) return null
  return (
    <Panel icon={<Layers />} title="Stapel – letzte 30 Tage" testId="stats-decks">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="py-1.5 pr-3 font-medium">Stapel</th>
              <th className="py-1.5 pr-3 text-right font-medium">Bewertungen</th>
              <th className="py-1.5 pr-3 text-right font-medium" title="Anteil gewusster Wiederholungen gelernter Karten">
                Trefferquote
              </th>
              <th className="py-1.5 text-right font-medium">Ø Zeit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border tabular-nums">
            {rows.map(({ deck, s }) => (
              <tr key={deck.id}>
                <td className="max-w-48 truncate py-1.5 pr-3">{deck.name}</td>
                <td className="py-1.5 pr-3 text-right">{s?.reviews ?? 0}</td>
                <td className="py-1.5 pr-3 text-right">{s?.matureReviews ? `${Math.round((s.matureCorrect / s.matureReviews) * 100)} %` : '–'}</td>
                <td className="py-1.5 text-right">{s?.reviews ? formatDuration(s.ms / s.reviews) : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}
