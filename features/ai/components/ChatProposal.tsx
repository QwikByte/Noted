'use client'
// Vorschlag von Claude im Chat: eine Notiz, Karteikarten oder ein Termin – angelegt wird erst mit dem Klick der Person
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CalendarPlus, Check, FilePlus, Layers } from 'lucide-react'
import { useApp } from '@/features/workspace/client/context'
import { createCards, createDeck, useFlashcards } from '@/features/flashcards/client/flashcards'
import { CardText } from '@/features/flashcards/components/common'
import { useEventMutations } from '@/features/calendar/client/calendar'
import { dateOf, longDate, timeOf, weekdayName, addDays } from '@/features/calendar/dates'
import { CardMarkdown } from '@/features/flashcards/components/CardMarkdown'
import { Button } from '@/shared/ui/button'
import { Input, Select } from '@/shared/ui/input'
import { ErrorText } from '@/shared/ui/toast'
import { errorMessage } from '@/shared/client/api'
import { chatStore } from '../client/chat'
import type { ChatProposal as Proposal } from '../types'

const NEW_DECK = '__new__'

export function ChatProposal({
  turnId,
  partId,
  proposal,
  applied,
}: {
  turnId: string
  partId: string
  proposal: Proposal
  applied?: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(fn: () => Promise<string>) {
    setBusy(true)
    setError(null)
    try {
      chatStore.markApplied(turnId, partId, await fn())
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-subtle/40 p-3" data-testid="chat-proposal">
      {proposal.kind === 'note' ? (
        <NoteProposal proposal={proposal} applied={applied} busy={busy} run={run} />
      ) : proposal.kind === 'cards' ? (
        <CardsProposal proposal={proposal} applied={applied} busy={busy} run={run} />
      ) : (
        <EventProposal proposal={proposal} applied={applied} busy={busy} run={run} />
      )}
      <ErrorText>{error}</ErrorText>
    </div>
  )
}

type Props<K extends Proposal['kind']> = {
  proposal: Extract<Proposal, { kind: K }>
  applied?: string
  busy: boolean
  run: (fn: () => Promise<string>) => Promise<void>
}

function Applied({ text }: { text: string }) {
  return (
    <p className="mt-2 flex items-center gap-1.5 text-sm text-success">
      <Check className="size-4" /> {text}
    </p>
  )
}

function NoteProposal({ proposal, applied, busy, run }: Props<'note'>) {
  const app = useApp()
  return (
    <>
      <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-faint">
        <FilePlus className="size-3.5" /> Neue Notiz
      </p>
      <p className="font-medium">{proposal.title}</p>
      <div className="mt-1 max-h-40 overflow-y-auto text-sm">
        <CardMarkdown text={proposal.content} />
      </div>
      {applied ? (
        <Applied text={applied} />
      ) : (
        <Button
          size="sm"
          variant="primary"
          className="mt-2"
          loading={busy}
          onClick={() =>
            void run(async () => {
              await app.createNote({ title: proposal.title, folderId: null, content: proposal.content, format: 'markdown' })
              return 'Notiz angelegt.'
            })
          }
        >
          Notiz anlegen
        </Button>
      )}
    </>
  )
}

function CardsProposal({ proposal, applied, busy, run }: Props<'cards'>) {
  const qc = useQueryClient()
  const { data } = useFlashcards()
  const decks = data?.decks ?? []
  const match = proposal.deck ? decks.find((d) => d.name.toLocaleLowerCase('de') === proposal.deck?.toLocaleLowerCase('de')) : undefined
  const [deckId, setDeckId] = useState<string>(match?.id ?? (decks.length && !proposal.deck ? decks[0].id : NEW_DECK))
  const [name, setName] = useState(proposal.deck ?? 'Aus dem KI-Chat')
  const n = proposal.cards.length
  return (
    <>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-faint">
        <Layers className="size-3.5" /> {n === 1 ? 'Eine Karteikarte' : `${n} Karteikarten`}
      </p>
      <ul className="max-h-60 space-y-2 overflow-y-auto">
        {proposal.cards.map((c, i) => (
          <li key={i} className="flex flex-col rounded-lg border border-border bg-elevated px-3 py-2">
            <CardText card={c} />
          </li>
        ))}
      </ul>
      {applied ? (
        <Applied text={applied} />
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select value={deckId} onChange={(e) => setDeckId(e.target.value)} aria-label="In Stapel" className="h-9! w-auto min-w-0 flex-1">
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
            <option value={NEW_DECK}>+ Neuer Stapel …</option>
          </Select>
          {deckId === NEW_DECK ? (
            <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name des neuen Stapels" maxLength={200} className="h-9! min-w-0 flex-1" />
          ) : null}
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            disabled={deckId === NEW_DECK && !name.trim()}
            onClick={() =>
              void run(async () => {
                const deck = deckId === NEW_DECK ? await createDeck(qc, { name: name.trim() }) : decks.find((d) => d.id === deckId)!
                await createCards(
                  qc,
                  deck.id,
                  proposal.cards.map((c) => ({ type: c.type, front: c.front, back: c.back, options: c.options, noteId: proposal.noteId })),
                )
                return `${n === 1 ? 'Karte' : `${n} Karten`} in „${deck.name}“ erstellt.`
              })
            }
          >
            {n === 1 ? 'Karte erstellen' : `${n} Karten erstellen`}
          </Button>
        </div>
      )}
    </>
  )
}

function EventProposal({ proposal, applied, busy, run }: Props<'event'>) {
  const app = useApp()
  const { create } = useEventMutations()
  const e = proposal.event
  const day = dateOf(e.start)
  const lastDay = e.allDay ? addDays(e.end, -1) : dateOf(e.end)
  const when = e.allDay
    ? `${weekdayName(day)}, ${longDate(day)}${lastDay !== day ? ` bis ${longDate(lastDay)}` : ''}, ganztägig`
    : `${weekdayName(day)}, ${longDate(day)}, ${timeOf(e.start)}–${timeOf(e.end)} Uhr`
  return (
    <>
      <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-faint">
        <CalendarPlus className="size-3.5" /> Termin
      </p>
      <p className="font-medium">{e.title}</p>
      <p className="text-sm text-muted">
        {when}
        {e.location ? ` · ${e.location}` : ''}
      </p>
      {e.notes ? <p className="mt-1 text-sm whitespace-pre-wrap">{e.notes}</p> : null}
      {applied ? (
        <Applied text={applied} />
      ) : (
        <div className="mt-2 flex gap-2">
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            onClick={() =>
              void run(async () => {
                await create.mutateAsync(e)
                return 'Im Kalender eingetragen.'
              })
            }
          >
            Eintragen
          </Button>
          <Button size="sm" variant="ghost" onClick={() => app.go({ kind: 'calendar' })}>
            Kalender öffnen
          </Button>
        </div>
      )}
    </>
  )
}
