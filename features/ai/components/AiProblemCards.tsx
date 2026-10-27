'use client'
// Problemkarten entschärfen: Claude schlägt für jede oft vergessene Karte eine leichter merkbare Fassung vor – klarer
// formuliert, mit Merkhilfe oder in wenige kleinere Karten geteilt. Übernommen wird Karte für Karte oder alle auf einmal.
import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, RotateCcw } from 'lucide-react'
import { createCards, resetCardProgress, updateCard } from '@/features/flashcards/client/flashcards'
import { CardText } from '@/features/flashcards/components/common'
import type { Card } from '@/features/flashcards/types'
import { Modal } from '@/shared/ui/modal'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { useToast } from '@/shared/ui/toast'
import { errorMessage } from '@/shared/client/api'
import { suggestCards, useAiSettings } from '../client/ai'
import { modelLabel } from '../models'
import type { SuggestedCard } from '../types'
import { AiSetupHint } from './AiSetupHint'

type Row =
  | { status: 'waiting' }
  | { status: 'running' }
  | { status: 'applying' }
  | { status: 'applied' }
  | { status: 'skipped' }
  | { status: 'done'; proposal: SuggestedCard[] }
  | { status: 'error'; message: string }

/** So viele Karten fragt der Dialog gleichzeitig an */
const PARALLEL = 2

export function AiProblemCards({ deckName, cards, onClose }: { deckName: string; cards: Card[]; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { data: settings } = useAiSettings()
  // Bildverdeckungen schlägt Claude nicht vor – sie bleiben dem Karteneditor
  const [list] = useState(() => cards.filter((c) => c.type !== 'occlusion'))
  const occlusions = cards.length - list.length
  const [rows, setRows] = useState<Record<string, Row>>(() => Object.fromEntries(list.map((c) => [c.id, { status: 'waiting' }])))
  const [relearn, setRelearn] = useState(true)
  const controller = useRef<AbortController | null>(null)
  const setRow = (id: string, row: Row) => setRows((r) => ({ ...r, [id]: row }))
  // Auch einzelne neue Vorschläge brechen ab, wenn der Dialog zugeht
  const signal = () => controller.current?.signal ?? new AbortController().signal

  async function propose(card: Card, signal: AbortSignal) {
    setRow(card.id, { status: 'running' })
    try {
      const proposal = await suggestCards(
        { source: { kind: 'card', mode: 'leech', card: { type: card.type as SuggestedCard['type'], front: card.front, back: card.back, options: card.options } } },
        signal,
      )
      setRow(card.id, proposal.length ? { status: 'done', proposal } : { status: 'error', message: 'Kein brauchbarer Vorschlag.' })
    } catch (err) {
      if (!signal.aborted) setRow(card.id, { status: 'error', message: errorMessage(err) })
    }
  }

  const ready = settings?.configured === true
  useEffect(() => {
    if (!ready) return
    const ctrl = new AbortController()
    controller.current = ctrl
    // Erst nach dem Rendern losschicken: Im StrictMode räumt React den ersten Durchlauf sofort wieder ab
    const timer = setTimeout(() => {
      const queue = [...list]
      const worker = async () => {
        for (let card = queue.shift(); card && !ctrl.signal.aborted; card = queue.shift()) await propose(card, ctrl.signal)
      }
      for (let i = 0; i < PARALLEL; i++) void worker()
    })
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
    // Nur einmal beim Öffnen – „Neu vorschlagen“ fragt einzeln
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  /** Erste vorgeschlagene Karte ersetzt die bisherige (Verknüpfung zur Notiz bleibt), weitere kommen dazu */
  async function apply(card: Card, proposal: SuggestedCard[]): Promise<boolean> {
    setRow(card.id, { status: 'applying' })
    try {
      const [first, ...rest] = proposal
      await updateCard(qc, card.id, { type: first.type, front: first.front, back: first.back, options: first.options })
      if (relearn) await resetCardProgress(qc, card.id)
      if (rest.length) {
        await createCards(
          qc,
          card.deckId,
          rest.map((c) => ({ type: c.type, front: c.front, back: c.back, options: c.options, noteId: card.noteId })),
        )
      }
      setRow(card.id, { status: 'applied' })
      return true
    } catch (err) {
      setRow(card.id, { status: 'error', message: errorMessage(err) })
      return false
    }
  }

  const open = list.filter((c) => rows[c.id]?.status === 'done')
  async function applyAll() {
    let n = 0
    for (const card of open) {
      const row = rows[card.id]
      if (row.status === 'done' && (await apply(card, row.proposal))) n++
    }
    toast.success(n === 1 ? '1 Karte überarbeitet.' : `${n} Karten überarbeitet.`)
  }

  const busy = list.some((c) => ['waiting', 'running', 'applying'].includes(rows[c.id]?.status))
  const footer = (
    <>
      <label className="mr-auto flex cursor-pointer items-center gap-2 self-center text-sm">
        <input type="checkbox" checked={relearn} onChange={(e) => setRelearn(e.target.checked)} className="accent-[var(--accent)]" />
        Danach neu lernen
      </label>
      <Button onClick={onClose}>Schließen</Button>
      <Button variant="primary" onClick={() => void applyAll()} disabled={open.length === 0} data-testid="ai-problem-apply-all">
        {open.length > 1 ? `Alle ${open.length} übernehmen` : 'Übernehmen'}
      </Button>
    </>
  )

  return (
    <Modal open onClose={onClose} title="Problemkarten mit KI überarbeiten" description={`„${deckName}“`} size="lg" footer={ready ? footer : undefined}>
      {!settings ? null : !ready ? (
        <AiSetupHint what="Problemkarten von Claude überarbeiten lassen" />
      ) : (
        <div className="space-y-3" data-testid="ai-problem-cards">
          <p className="text-sm text-muted">
            Claude macht oft vergessene Karten leichter merkbar: klarer formuliert, mit Merkhilfe oder in kleinere Karten geteilt.
            Die erste Karte eines Vorschlags ersetzt die bisherige, weitere kommen dazu. „Neu lernen“ setzt den Lernstand zurück
            und hebt das Aussetzen auf.
          </p>
          {occlusions > 0 ? (
            <p className="text-sm text-muted">
              {occlusions === 1 ? 'Eine Bildverdeckung überarbeitest' : `${occlusions} Bildverdeckungen überarbeitest`} du im
              Karteneditor.
            </p>
          ) : null}
          <ul className="space-y-2">
            {list.map((card) => {
              const row = rows[card.id] ?? { status: 'waiting' }
              return (
                <li key={card.id} className="rounded-xl border border-border p-3" data-testid="ai-problem-card">
                  <p className="mb-1 text-xs font-medium text-faint">Bisher</p>
                  <span className="flex flex-col">
                    <CardText card={card} />
                  </span>
                  <div className="mt-3 border-t border-border pt-3">
                    {row.status === 'waiting' || row.status === 'running' ? (
                      <p className="flex items-center gap-2 text-sm text-muted">
                        <Loader2 className="size-4 animate-spin" /> {row.status === 'running' ? 'Claude überarbeitet die Karte …' : 'Wartet …'}
                      </p>
                    ) : row.status === 'applied' ? (
                      <p className="text-sm text-success">Übernommen.</p>
                    ) : row.status === 'skipped' ? (
                      <p className="text-sm text-muted">Übersprungen.</p>
                    ) : row.status === 'error' ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="flex-1 text-sm text-danger">{row.message}</p>
                        <Button size="sm" onClick={() => void propose(card, signal())}>
                          <RotateCcw className="size-4" /> Noch einmal
                        </Button>
                      </div>
                    ) : row.status === 'applying' ? (
                      <p className="flex items-center gap-2 text-sm text-muted">
                        <Loader2 className="size-4 animate-spin" /> Wird übernommen …
                      </p>
                    ) : (
                      <>
                        <p className="mb-1 text-xs font-medium text-faint">
                          Vorschlag{row.proposal.length > 1 ? ` – ${row.proposal.length} Karten` : ''}
                        </p>
                        <ul className="space-y-2">
                          {row.proposal.map((p, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <ProposalText card={p} />
                              {i > 0 ? <Badge tone="accent">Neu</Badge> : null}
                            </li>
                          ))}
                        </ul>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button size="sm" variant="primary" onClick={() => void apply(card, row.proposal)}>
                            Übernehmen
                          </Button>
                          <Button size="sm" onClick={() => void propose(card, signal())}>
                            Neu vorschlagen
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setRow(card.id, { status: 'skipped' })}>
                            Überspringen
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
          <p className="text-xs text-muted">
            {busy ? 'Claude arbeitet noch an Vorschlägen. ' : ''}Die Karten gehen an Anthropic ({modelLabel(settings.model)}).
          </p>
        </div>
      )}
    </Modal>
  )
}

/** Vorgeschlagene Karte ganz – anders als in Listen nicht gekürzt, damit auch die Merkhilfe zu sehen ist */
function ProposalText({ card }: { card: SuggestedCard }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col text-sm whitespace-pre-line">
      <span className="font-medium">{card.front}</span>
      <span className="text-muted">
        {card.type === 'mc' ? card.options.map((o) => (o.correct ? `✓ ${o.text}` : o.text)).join(' · ') : card.back}
      </span>
    </span>
  )
}
