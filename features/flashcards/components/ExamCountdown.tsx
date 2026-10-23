'use client'
// Startseite: anstehende Klausuren mit Countdown und dem Lernstand der verknüpften Stapel
import { Dumbbell, GraduationCap } from 'lucide-react'
import { useApp } from '@/features/workspace/client/context'
import { useEvents } from '@/features/calendar/client/calendar'
import { dateOf, daysBetween, localDate, shortDate, timeOf, weekdayName } from '@/features/calendar/dates'
import type { CalendarEvent } from '@/features/calendar/types'
import { Button } from '@/shared/ui/button'
import { MenuItem, useContextMenu } from '@/shared/ui/menu'
import { Panel } from '@/shared/ui/panel'
import { useNow } from '@/shared/client/now'
import { useFlashcards, type Flashcards } from '../client/flashcards'
import { cardsByDeck, deckCounts } from '../study'
import { ProgressBar, statusCounts } from './common'

/** Höchstens so viele Klausuren – die nächsten zuerst */
const MAX_EXAMS = 3

const countdown = (days: number) => (days === 0 ? 'heute' : days === 1 ? 'morgen' : `in ${days} Tagen`)

export function ExamCountdown() {
  const { data: events } = useEvents()
  const { data } = useFlashcards()
  const now = useNow()
  const today = localDate(new Date(now))
  const exams = (events ?? [])
    .filter((e) => e.exam && dateOf(e.start) >= today)
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, MAX_EXAMS)
  if (exams.length === 0) return null
  return (
    <Panel title="Klausuren" className="mb-4" testId="exams">
      <ul className="divide-y divide-border">
        {exams.map((e) => (
          <ExamRow key={e.id} exam={e} days={daysBetween(today, dateOf(e.start))} data={data} now={now} />
        ))}
      </ul>
    </Panel>
  )
}

function ExamRow({ exam, days, data, now }: { exam: CalendarEvent; days: number; data: Flashcards | null; now: number }) {
  const app = useApp()
  const openContextMenu = useContextMenu()
  const date = dateOf(exam.start)
  const deckIds = new Set(exam.exam?.deckIds)
  const decks = data?.decks.filter((d) => deckIds.has(d.id)) ?? []
  const cards = data?.cards.filter((c) => deckIds.has(c.deckId) && !c.suspended) ?? []
  const status = data ? statusCounts(cards, data.states) : null
  const total = status ? status.new + status.learning + status.young + status.mature : 0
  let due = 0
  if (data) {
    const byDeck = cardsByDeck(data.cards)
    due = decks.reduce((sum, d) => sum + deckCounts(d, byDeck.get(d.id) ?? [], data.states, now).due, 0)
  }
  const canStudy = decks.length > 0 && total > 0
  const learn = () => app.go({ kind: 'study', scope: `exam:${exam.id}`, mode: 'learn' })
  const practice = () => app.go({ kind: 'study', scope: `exam:${exam.id}`, mode: 'practice' })

  return (
    <li
      className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 first:pt-0 last:pb-0"
      data-testid="exam"
      onContextMenu={(e) =>
        openContextMenu(
          e,
          canStudy ? (
            <>
              {due > 0 ? (
                <MenuItem icon={<GraduationCap />} onSelect={learn}>
                  Lernen
                </MenuItem>
              ) : null}
              <MenuItem icon={<Dumbbell />} onSelect={practice}>
                Üben
              </MenuItem>
            </>
          ) : null,
          { copy: true },
        )
      }
    >
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="truncate font-medium">{exam.title}</span>
          <span className="shrink-0 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger">{countdown(days)}</span>
          <span className="text-xs text-muted tabular-nums">
            {weekdayName(date)}, {shortDate(date)}
            {exam.allDay ? '' : ` · ${timeOf(exam.start)}`}
          </span>
        </p>
        {!status ? null : decks.length === 0 ? (
          <p className="mt-1 text-xs text-muted">Keine Karteikarten verknüpft – wähle die Stapel im Termin aus.</p>
        ) : (
          <>
            <ProgressBar counts={status} className="mt-2 max-w-sm" />
            <p className="mt-1 text-xs text-muted">
              {total === 0 ? 'Noch keine Karten' : `${Math.floor(((total - status.new) / total) * 100)} % gelernt`}
              {status.new > 0 ? ` · ${status.new} neu` : ''}
              {due > 0 ? ` · heute ${due} fällig` : ''}
              {decks.length > 1 ? ` · ${decks.length} Stapel` : ` · ${decks[0].name}`}
            </p>
          </>
        )}
      </div>
      {canStudy ? (
        <div className="flex shrink-0 gap-1">
          {due > 0 ? (
            <Button size="sm" variant="primary" onClick={learn}>
              <GraduationCap className="size-4" /> Lernen
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={practice}>
            <Dumbbell className="size-4" /> Üben
          </Button>
        </div>
      ) : null}
    </li>
  )
}
