'use client'
// Karteneditor: die Karte von Claude überarbeiten lassen – der Vorschlag ersetzt die Felder erst mit „Übernehmen“,
// gespeichert wird wie immer mit „Speichern“.
import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { CARD_TYPE_LABELS } from '@/features/flashcards/client/flashcards'
import { CardText } from '@/features/flashcards/components/common'
import type { CardOption } from '@/features/flashcards/types'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Input } from '@/shared/ui/input'
import { ErrorText } from '@/shared/ui/toast'
import { errorMessage } from '@/shared/client/api'
import { suggestCards } from '../client/ai'
import { MAX_AI_WISHES } from '../limits'
import type { SuggestedCard } from '../types'

type Draft = { type: SuggestedCard['type']; front: string; back: string; options: CardOption[] }

export function AiCardImprove({ card, onApply, onClose }: { card: Draft; onApply: (card: Draft) => void; onClose: () => void }) {
  const [wishes, setWishes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [proposal, setProposal] = useState<SuggestedCard | null>(null)
  const running = useRef<AbortController | null>(null)
  // Editor geschlossen: Anfrage abbrechen
  useEffect(() => () => running.current?.abort(), [])

  async function run() {
    running.current?.abort()
    const controller = new AbortController()
    running.current = controller
    setBusy(true)
    setError(null)
    try {
      const [next] = await suggestCards({ source: { kind: 'card', mode: 'improve', card }, wishes }, controller.signal)
      if (!next) setError('Claude hat keinen brauchbaren Vorschlag geliefert. Versuch es noch einmal.')
      setProposal(next ?? null)
    } catch (err) {
      if (!controller.signal.aborted) setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-2.5 rounded-xl border border-border p-3" data-testid="ai-card-improve">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="size-4 text-accent-text" /> Mit KI überarbeiten
      </h3>
      {/* Kein eigenes <form>: Der Abschnitt steckt im Formular des Karteneditors, verschachtelte Formulare schickt der
          Browser selbst ab */}
      <div className="flex flex-wrap gap-2">
        <Input
          value={wishes}
          onChange={(e) => setWishes(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.ctrlKey || e.metaKey) return
            e.preventDefault()
            if (!busy && card.front.trim()) void run()
          }}
          maxLength={MAX_AI_WISHES}
          placeholder="Wünsche, z. B. „kürzer“ oder „als Lückentext“"
          aria-label="Wünsche an Claude (optional)"
          disabled={busy}
          className="h-10! min-w-48 flex-1"
        />
        <Button onClick={() => void run()} loading={busy} disabled={!card.front.trim()}>
          {proposal ? 'Neu vorschlagen' : 'Vorschlagen'}
        </Button>
      </div>
      <ErrorText>{error}</ErrorText>
      {proposal ? (
        <div className="space-y-2 rounded-lg bg-subtle p-3">
          <span className="flex flex-col">
            <CardText card={proposal} />
          </span>
          {proposal.type !== card.type ? <Badge tone="accent">{CARD_TYPE_LABELS[proposal.type]}</Badge> : null}
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={() => onApply(proposal)}>
              Übernehmen
            </Button>
            <Button size="sm" onClick={onClose}>
              Verwerfen
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
