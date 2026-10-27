'use client'
// Karteikarten von Claude vorschlagen lassen und auswählen – aus PDF-Seiten oder -Markierungen oder als Aufteilung einer
// Karte. Gespeichert wird erst mit „Karten erstellen“.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { useApp } from '@/features/workspace/client/context'
import { CARD_TYPE_LABELS, createCards, createDeck, useFlashcards } from '@/features/flashcards/client/flashcards'
import { CardText } from '@/features/flashcards/components/common'
import { normFront } from '@/features/flashcards/note-sync'
import { Modal } from '@/shared/ui/modal'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Field, Input, Select } from '@/shared/ui/input'
import { ErrorText, useToast } from '@/shared/ui/toast'
import { cn } from '@/shared/ui/cn'
import { usePref } from '@/shared/client/prefs'
import { errorMessage } from '@/shared/client/api'
import { suggestCards, useAiSettings } from '../client/ai'
import { MAX_AI_WISHES } from '../limits'
import { modelLabel } from '../models'
import { formatPageList, parsePageList } from '../pages'
import type { CardSource, SuggestedCard } from '../types'
import { AiSetupHint } from './AiSetupHint'

const NEW_DECK = '__new__'

type Phase = 'idle' | 'preparing' | 'asking'

export function AiCardsDialog({
  subject,
  pages,
  source,
  autoStart,
  deckId: initialDeck,
  deckName,
  noteId,
  link,
  extra,
  onClose,
}: {
  /** Worum es geht, z. B. der Name des PDFs */
  subject: string
  /** Seitenauswahl für PDF-Seiten: vorausgewählte Seiten und Seitenzahl des PDFs */
  pages?: { initial: number[]; count: number }
  /** Baut die Quelle – bei Seitenauswahl aus den gewählten Seiten (Bilder entstehen erst hier) */
  source: (pages: number[] | null) => Promise<CardSource>
  /** Gleich beim Öffnen vorschlagen lassen */
  autoStart?: boolean
  /** Vorausgewählter Stapel – sonst der zuletzt benutzte */
  deckId?: string
  /** Vorschlag für einen neuen Stapel */
  deckName: string
  /** Notiz, mit der die Karten verknüpft werden */
  noteId: string | null
  /** Seitenlink, der bei Karten aus einer PDF-Seite unten auf die Rückseite kommt */
  link?: (page: number) => string
  /** Zusätzliche Aktion nach dem Anlegen, z. B. die aufgeteilte Karte aussetzen */
  extra?: { label: string; checked: boolean; run: () => Promise<void> }
  onClose: () => void
}) {
  const app = useApp()
  const qc = useQueryClient()
  const toast = useToast()
  const { data: settings } = useAiSettings()
  const { data } = useFlashcards()
  const decks = useMemo(() => data?.decks ?? [], [data])
  const [lastDeck, setLastDeck] = usePref<string>('noted:lastDeck', '')
  const [deckChoice, setDeckChoice] = useState<string | null>(null)
  const fallbackDeck = initialDeck ?? (decks.some((d) => d.id === lastDeck) ? lastDeck : (decks[0]?.id ?? NEW_DECK))
  const deckId = deckChoice ?? fallbackDeck
  const [newName, setNewName] = useState(deckName)
  const [pageInput, setPageInput] = useState(pages ? formatPageList(pages.initial) : '')
  const [wishes, setWishes] = useState('')
  const [phase, setPhase] = useState<Phase>(autoStart ? 'preparing' : 'idle')
  const [error, setError] = useState<string | null>(null)
  const [cards, setCards] = useState<SuggestedCard[] | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [doExtra, setDoExtra] = useState(extra?.checked ?? false)
  const [saving, setSaving] = useState(false)
  const running = useRef<AbortController | null>(null)

  const existing = useMemo(
    () => new Set((data?.cards ?? []).filter((c) => c.deckId === deckId).map((c) => normFront(c.front))),
    [data, deckId],
  )

  // Geschlossen: Anfrage abbrechen, damit Claude nicht umsonst weiterschreibt
  useEffect(() => () => running.current?.abort(), [])

  /** Vorschläge holen – Zustand setzt erst die Antwort (den Anfang „wird vorbereitet“ setzt der Aufrufer) */
  async function ask(chosen: number[] | null) {
    running.current?.abort()
    const controller = new AbortController()
    running.current = controller
    try {
      const built = await source(chosen)
      if (controller.signal.aborted) return
      setPhase('asking')
      const result = await suggestCards({ source: built, wishes }, controller.signal)
      setCards(result)
      // Vorausgewählt: was es im Stapel noch nicht gibt
      setSelected(new Set(result.map((c, i) => (existing.has(normFront(c.front)) ? -1 : i)).filter((i) => i >= 0)))
      setPhase('idle')
    } catch (err) {
      if (controller.signal.aborted) return
      setError(errorMessage(err))
      setPhase('idle')
    }
  }

  function start() {
    let chosen: number[] | null = null
    if (pages) {
      const parsed = parsePageList(pageInput, pages.count)
      if (typeof parsed === 'string') return setError(parsed)
      chosen = parsed
    }
    setError(null)
    setCards(null)
    setPhase('preparing')
    void ask(chosen)
  }

  const ready = settings?.configured === true
  useEffect(() => {
    if (!ready || !autoStart) return
    // Nach dem Rendern losschicken – im StrictMode geht so keine abgebrochene Anfrage hinaus
    const timer = setTimeout(() => void ask(pages?.initial ?? null))
    return () => {
      clearTimeout(timer)
      running.current?.abort()
    }
    // Nur beim Öffnen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  async function create() {
    if (!cards) return
    const chosen = cards.filter((_, i) => selected.has(i))
    if (!chosen.length) return setError('Wähle mindestens eine Karte aus.')
    if (deckId === NEW_DECK && !newName.trim()) return setError('Bitte gib einen Namen für den neuen Stapel ein.')
    setSaving(true)
    setError(null)
    try {
      const target = deckId === NEW_DECK ? (await createDeck(qc, { name: newName.trim() })).id : deckId
      await createCards(
        qc,
        target,
        chosen.map((c) => ({
          type: c.type,
          front: c.front,
          back: link && c.page ? [c.back, link(c.page)].filter(Boolean).join('\n\n') : c.back,
          options: c.options,
          noteId,
        })),
      )
      setLastDeck(target)
      if (extra && doExtra) await extra.run()
      toast.show(`${chosen.length} ${chosen.length === 1 ? 'Karte' : 'Karten'} erstellt.`, {
        tone: 'success',
        duration: 6000,
        action: { label: 'Jetzt lernen', onClick: () => app.go({ kind: 'study', scope: `deck:${target}`, mode: 'learn' }) },
      })
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const busy = phase !== 'idle'
  return (
    <Modal
      open
      onClose={onClose}
      title="Karteikarten mit KI"
      description={`„${subject}“`}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          {cards?.length ? (
            <Button variant="primary" onClick={() => void create()} loading={saving} disabled={selected.size === 0} data-testid="ai-create-cards">
              {selected.size} {selected.size === 1 ? 'Karte' : 'Karten'} erstellen
            </Button>
          ) : null}
        </>
      }
    >
      {!settings ? null : !settings.configured ? (
        <AiSetupHint what="Karten von Claude vorschlagen lassen" />
      ) : (
        <div className="space-y-4" data-testid="ai-cards-dialog">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (!busy) start()
            }}
          >
            {pages ? (
              <Field label="Seiten" hint={`Das PDF hat ${pages.count} ${pages.count === 1 ? 'Seite' : 'Seiten'}. Zum Beispiel „3–5, 8“.`}>
                {(id) => <Input id={id} value={pageInput} onChange={(e) => setPageInput(e.target.value)} disabled={busy} />}
              </Field>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Input
                value={wishes}
                onChange={(e) => setWishes(e.target.value)}
                maxLength={MAX_AI_WISHES}
                placeholder="Wünsche, z. B. „nur Definitionen“ oder „auf Englisch“"
                aria-label="Wünsche an Claude (optional)"
                disabled={busy}
                className="h-10! min-w-48 flex-1"
              />
              <Button type="submit" loading={busy}>
                <Sparkles className="size-4" /> {cards ? 'Neu vorschlagen' : 'Karten vorschlagen'}
              </Button>
            </div>
          </form>

          <ErrorText>{error}</ErrorText>
          <p className="text-xs text-muted" role="status">
            {phase === 'preparing'
              ? 'Wird vorbereitet …'
              : phase === 'asking'
                ? 'Claude liest – das dauert meist bis zu einer Minute.'
                : cards && cards.length === 0
                  ? 'Claude hat hier nichts gefunden, woraus sich Karten machen lassen.'
                  : `Der Inhalt geht an Anthropic (${modelLabel(settings.model)}).`}
          </p>

          {cards?.length ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="In Stapel">
                  {(id) => (
                    <Select id={id} value={deckId} onChange={(e) => setDeckChoice(e.target.value)}>
                      {decks.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                      <option value={NEW_DECK}>+ Neuer Stapel …</option>
                    </Select>
                  )}
                </Field>
                {deckId === NEW_DECK ? (
                  <Field label="Name des neuen Stapels">
                    {(id) => <Input id={id} value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={200} />}
                  </Field>
                ) : null}
              </div>
              <ul className="max-h-[45vh] divide-y divide-border overflow-y-auto rounded-xl border border-border" data-testid="ai-card-list">
                {cards.map((c, i) => {
                  const on = selected.has(i)
                  return (
                    <li key={i}>
                      <label className={cn('flex cursor-pointer gap-3 px-3 py-2.5 hover:bg-hover', !on && 'opacity-70')}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(e) => {
                            const next = new Set(selected)
                            if (e.target.checked) next.add(i)
                            else next.delete(i)
                            setSelected(next)
                          }}
                          className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
                        />
                        <span className="min-w-0 flex-1">
                          <CardText card={c} />
                          <span className="mt-1 flex flex-wrap gap-1.5">
                            {c.type !== 'basic' ? <Badge>{CARD_TYPE_LABELS[c.type]}</Badge> : null}
                            {c.page ? <Badge>S. {c.page}</Badge> : null}
                            {existing.has(normFront(c.front)) ? <Badge tone="warning">Schon vorhanden</Badge> : null}
                          </span>
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
              {extra ? (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={doExtra}
                    onChange={(e) => setDoExtra(e.target.checked)}
                    className="size-4 accent-[var(--accent)]"
                  />
                  {extra.label}
                </label>
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </Modal>
  )
}
