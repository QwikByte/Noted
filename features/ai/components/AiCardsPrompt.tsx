'use client'
// „Karteikarten aus Notiz“: Claude Karten vorschlagen lassen. Die Vorschläge landen im Dialog wie erkannte Karten –
// gespeichert wird erst, was man dort übernimmt.
import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { ErrorText } from '@/shared/ui/toast'
import { errorMessage } from '@/shared/client/api'
import { suggestCards, useAiSettings } from '../client/ai'
import { MAX_AI_EXISTING, MAX_AI_NOTE_CHARS, MAX_AI_WISHES } from '../limits'
import { modelLabel } from '../models'
import type { SuggestedCard } from '../types'
import { AiSetupHint } from './AiSetupHint'

export function AiCardsPrompt({
  note,
  existing,
  suggested,
  onCards,
}: {
  note: { id: string; title: string; content: string }
  /** Vorderseiten der Karten, die es zur Notiz schon gibt – Claude soll sie nicht noch einmal vorschlagen */
  existing: string[]
  /** Hat Claude in diesem Dialog schon vorgeschlagen? */
  suggested: boolean
  onCards: (cards: SuggestedCard[]) => void
}) {
  const { data: settings } = useAiSettings()
  const [wishes, setWishes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [empty, setEmpty] = useState(false)
  const running = useRef<AbortController | null>(null)
  // Dialog geschlossen: Anfrage abbrechen, damit Claude nicht umsonst weiterschreibt
  useEffect(() => () => running.current?.abort(), [])

  if (!settings) return null
  if (!settings.configured) return <AiSetupHint what="Karten von Claude vorschlagen lassen" />

  const tooLong = note.content.length > MAX_AI_NOTE_CHARS

  async function run() {
    const controller = new AbortController()
    running.current = controller
    setLoading(true)
    setError(null)
    setEmpty(false)
    try {
      const cards = await suggestCards(
        {
          source: { kind: 'note', noteId: note.id, title: note.title, content: note.content },
          existing: existing.slice(0, MAX_AI_EXISTING),
          wishes,
        },
        controller.signal,
      )
      setEmpty(cards.length === 0)
      onCards(cards)
    } catch (err) {
      if (!controller.signal.aborted) setError(errorMessage(err))
    } finally {
      if (running.current === controller) running.current = null
      setLoading(false)
    }
  }

  return (
    <section className="space-y-2.5 rounded-xl border border-border p-3" data-testid="ai-cards">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="size-4 text-accent-text" /> Von Claude vorschlagen lassen
      </h3>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!loading) void run()
        }}
      >
        <Input
          value={wishes}
          onChange={(e) => setWishes(e.target.value)}
          maxLength={MAX_AI_WISHES}
          placeholder="Wünsche, z. B. „nur Definitionen“ oder „auf Englisch“"
          aria-label="Wünsche an Claude (optional)"
          disabled={loading}
          className="h-10! min-w-48 flex-1"
        />
        {loading ? <Button onClick={() => running.current?.abort()}>Abbrechen</Button> : null}
        <Button type="submit" loading={loading} disabled={tooLong || !note.content.trim()}>
          {suggested ? 'Neu vorschlagen' : 'Karten vorschlagen'}
        </Button>
      </form>
      <ErrorText>
        {tooLong
          ? `Die Notiz ist für Claude zu lang (höchstens ${MAX_AI_NOTE_CHARS.toLocaleString('de-DE')} Zeichen). Teile sie auf.`
          : error}
      </ErrorText>
      <p className="text-xs text-muted" role="status">
        {loading
          ? 'Claude liest die Notiz – das dauert meist bis zu einer Minute.'
          : empty
            ? 'Claude hat in dieser Notiz nichts gefunden, woraus sich Karten machen lassen.'
            : `Titel und Text der Notiz gehen an Anthropic (${modelLabel(settings.model)}).`}
      </p>
    </section>
  )
}
