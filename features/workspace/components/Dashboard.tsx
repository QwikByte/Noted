'use client'
// Startseite: setzt Termine (Kalender), fällige Karteikarten und Notizen zusammen – nach einer Vorlesung mit dem
// Hinweis, Karten aus der Mitschrift zu erstellen, und mit dem Countdown bis zu den nächsten Klausuren
import { useUser } from '@/features/auth/client/current-user'
import { Agenda } from '@/features/calendar/components/Agenda'
import { DueDecks } from '@/features/flashcards/components/DueDecks'
import { ExamCountdown } from '@/features/flashcards/components/ExamCountdown'
import { HomeNotes } from '@/features/notes/components/views'
import { Page, PageHeader } from '@/shared/ui/page-layout'
import { LectureCardsHint } from './LectureCardsHint'

function greeting() {
  const h = new Date().getHours()
  if (h < 5) return 'Gute Nacht'
  if (h < 11) return 'Guten Morgen'
  if (h < 17) return 'Hallo'
  if (h < 22) return 'Guten Abend'
  return 'Gute Nacht'
}

export function Dashboard() {
  const user = useUser()
  return (
    <Page>
      <PageHeader title={`${greeting()}, ${user.displayName.split(' ')[0]}!`} subtitle="Was möchtest du heute festhalten?" />
      <LectureCardsHint />
      <ExamCountdown />
      {/* Offline ohne geladene Termine und ohne Stapel bleibt die Zeile leer – dann ohne Abstand */}
      <div className="mb-10 flex flex-col gap-4 empty:hidden lg:flex-row lg:items-start">
        <Agenda className="min-w-0 lg:flex-[3]" />
        <DueDecks className="min-w-0 lg:flex-[2]" />
      </div>
      <HomeNotes />
    </Page>
  )
}
