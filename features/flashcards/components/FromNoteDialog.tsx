'use client'
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { useApp, type CardsFromNoteInit } from '@/features/workspace/client/context'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Field, Input, Select } from '@/shared/ui/input'
import { Modal } from '@/shared/ui/modal'
import { useToast } from '@/shared/ui/toast'
import { cn } from '@/shared/ui/cn'
import { CARD_TYPE_LABELS, createCards, createDeck, deleteCard, updateCard, useFlashcards } from '../client/flashcards'
import { usePref } from '@/shared/client/prefs'
import { errorMessage } from '@/shared/client/api'
import { AiCardsPrompt } from '@/features/ai/components/AiCardsPrompt'
import type { SuggestedCard } from '@/features/ai/types'
import { EXPLICIT_SOURCES, SOURCE_LABELS, parseCardsFromNote, type CandidateSource } from '../card-markdown'
import { changedParts, noteCards, normFront as norm, syncCards } from '../note-sync'
import type { Card } from '../types'
import { CardText } from './common'

const NEW_DECK = '__new__'
/** Herkunft einer Karte im Dialog: aus der Notiz erkannt oder von Claude vorgeschlagen */
type Source = CandidateSource | 'ai'
const SOURCES: Source[] = ['ai', 'syntax', 'question', 'cloze', 'definition', 'bold', 'highlight', 'heading']
const LABELS: Record<Source, string> = { ...SOURCE_LABELS, ai: 'Von Claude vorgeschlagen' }

/** Was mit einer Karte geschieht, die es in der Notiz nicht mehr gibt */
type OrphanAction = 'keep' | 'suspend' | 'unlink' | 'delete'
const ORPHAN_ACTIONS: { value: OrphanAction; label: string }[] = [
  { value: 'keep', label: 'Behalten' },
  { value: 'suspend', label: 'Aussetzen' },
  { value: 'unlink', label: 'Verknüpfung lösen' },
  { value: 'delete', label: 'Löschen' },
]

const PART_LABELS = { front: 'Frage', back: 'Antwort', type: 'Kartentyp' }

function SyntaxHelp() {
  return (
    <div className="space-y-2 text-sm text-muted">
      <p>Schreib Karten direkt in deine Notizen:</p>
      <pre className="overflow-x-auto rounded-lg bg-subtle p-3 text-[13px] leading-relaxed text-fg">
        {`Was ist ein Körper?::Eine Menge mit + und · …
Haus:::house            ← beidseitig

Nenne die Peano-Axiome
?
1. 0 ist eine natürliche Zahl …

Welche Aussagen stimmen?
?
- [x] richtig
- [ ] falsch`}
      </pre>
      <p>Außerdem erkannt: Frage-Callouts (<code>&gt; [!question] …</code>), Definitionen (<code>&gt; [!info] Begriff</code>), fett gedruckte Begriffe mit Erklärung und Überschriften mit ihrem Abschnitt.</p>
    </div>
  )
}

export function CardsFromNoteDialog({ note, onClose }: { note: CardsFromNoteInit; onClose: () => void }) {
  const app = useApp()
  const qc = useQueryClient()
  const toast = useToast()
  const { data } = useFlashcards()
  const decks = useMemo(() => data?.decks ?? [], [data])
  const [lastDeck, setLastDeck] = usePref<string>('noted:lastDeck', '')
  const candidates = useMemo(() => parseCardsFromNote(note.content), [note.content])
  // Vorschläge von Claude hinten anhängen – so behalten die erkannten Karten ihre Indizes für den Abgleich
  const [aiCards, setAiCards] = useState<SuggestedCard[]>([])
  const [aiDone, setAiDone] = useState(false)
  const entries = useMemo(
    () => [...candidates, ...aiCards.map((c) => ({ ...c, source: 'ai' as Source, line: -1 }))],
    [candidates, aiCards],
  )
  // Karten, die schon aus dieser Notiz entstanden sind: geändert oder nicht mehr in der Notiz?
  const sync = useMemo(() => syncCards(candidates, noteCards(data?.cards ?? [], note.id)), [candidates, data, note.id])
  const changedIndex = useMemo(() => new Set(sync.changed.map((c) => c.candidate)), [sync])

  // Vorschlag: der Stapel, in dem schon Karten aus dieser Notiz liegen – sonst der zuletzt benutzte
  const suggested = useMemo(() => {
    const counts = new Map<string, number>()
    for (const c of data?.cards ?? []) if (c.noteId === note.id) counts.set(c.deckId, (counts.get(c.deckId) ?? 0) + 1)
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    if (best) return best
    if (decks.some((d) => d.id === lastDeck)) return lastDeck
    return decks[0]?.id ?? NEW_DECK
  }, [data, decks, lastDeck, note.id])
  const [deckChoice, setDeckChoice] = useState<string | null>(null)
  const deckId = deckChoice ?? suggested
  const [deckName, setDeckName] = useState(note.title)

  const existing = useMemo(() => {
    const set = new Set<string>()
    for (const c of data?.cards ?? []) if (c.deckId === deckId || c.noteId === note.id) set.add(norm(c.front))
    return set
  }, [data, deckId, note.id])
  const parsedFronts = useMemo(() => new Set(candidates.map((c) => norm(c.front))), [candidates])
  // Ein Vorschlag von Claude ist auch doppelt, wenn die Karte schon in der Notiz erkannt wurde
  const duplicates = useMemo(() => {
    const dup = (front: string, i: number) =>
      existing.has(norm(front)) || (i >= candidates.length && parsedFronts.has(norm(front)))
    return new Set(entries.map((c, i) => (dup(c.front, i) ? i : -1)).filter((i) => i >= 0))
  }, [entries, candidates, existing, parsedFronts])
  const isDuplicate = (i: number) => duplicates.has(i)

  const [selected, setSelected] = useState<Set<number> | null>(null)
  // Vorauswahl: eindeutige Karten – oder die übergebenen Abschnitte (z. B. die beim Abfragen nicht gewussten)
  const preselect = useMemo(() => (note.preselect ? new Set(note.preselect) : null), [note.preselect])
  const effective = useMemo(() => {
    if (selected) return selected
    const wanted = (c: (typeof entries)[number]) =>
      c.source === 'ai' ||
      (preselect ? c.source === 'heading' && preselect.has(c.line) : EXPLICIT_SOURCES.includes(c.source))
    const fresh = (i: number) => !duplicates.has(i) && !changedIndex.has(i)
    return new Set(entries.map((c, i) => (wanted(c) && fresh(i) ? i : -1)).filter((i) => i >= 0))
  }, [selected, entries, duplicates, preselect, changedIndex])
  // Aktualisieren: vorausgewählt nur bei gleicher Vorderseite – eine ähnliche ist nur ein Vorschlag
  const [updates, setUpdates] = useState<Set<number> | null>(null)
  const effectiveUpdates = useMemo(
    () => updates ?? new Set(sync.changed.filter((c) => c.exact).map((c) => c.candidate)),
    [updates, sync],
  )
  const [orphanActions, setOrphanActions] = useState<Record<string, OrphanAction>>({})
  const orphanAction = (card: Card) => orphanActions[card.id] ?? 'keep'
  const orphanChoices = sync.orphaned.filter((c) => orphanAction(c) !== 'keep')
  const total = effective.size + effectiveUpdates.size + orphanChoices.length
  const [open, setOpen] = useState<Set<Source>>(
    () => new Set<Source>(['ai', ...(note.preselect ? ['heading' as const] : EXPLICIT_SOURCES)]),
  )
  const [help, setHelp] = useState(candidates.length === 0)
  const [changedOpen, setChangedOpen] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Für Claude: die Vorderseiten der Karten, die schon aus dieser Notiz stammen
  const linkedFronts = useMemo(() => noteCards(data?.cards ?? [], note.id).map((c) => c.front), [data, note.id])

  /** Neue Vorschläge ersetzen die bisherigen – ausgewählt sind die, die es noch nicht gibt */
  function receiveSuggestions(cards: SuggestedCard[]) {
    setAiCards(cards)
    setAiDone(true)
    if (!selected) return
    const base = candidates.length
    const next = new Set([...selected].filter((i) => i < base))
    cards.forEach((c, k) => {
      if (!existing.has(norm(c.front)) && !parsedFronts.has(norm(c.front))) next.add(base + k)
    })
    setSelected(next)
  }

  const toggle = (indices: number[], on: boolean) => {
    const next = new Set(effective)
    for (const i of indices) {
      if (on) next.add(i)
      else next.delete(i)
    }
    setSelected(next)
  }

  async function submit() {
    const chosen = [...effective].sort((a, b) => a - b).map((i) => entries[i])
    const changed = sync.changed.filter((c) => effectiveUpdates.has(c.candidate))
    if (total === 0) return setError('Wähle mindestens eine Karte aus.')
    if (chosen.length > 0 && deckId === NEW_DECK && !deckName.trim()) {
      return setError('Bitte gib einen Namen für den neuen Stapel ein.')
    }
    setSaving(true)
    setError(null)
    try {
      if (chosen.length > 0) {
        const target = deckId === NEW_DECK ? (await createDeck(qc, { name: deckName.trim() })).id : deckId
        await createCards(
          qc,
          target,
          chosen.map(({ type, front, back, options }) => ({ type, front, back, options, noteId: note.id })),
        )
        setLastDeck(target)
      }
      // Bearbeiten behält den Lernstand; bei Lückentexten wandert er mit seiner Lücke, ein Zusatz auf der Karte bleibt
      for (const { candidate, card } of changed) {
        const { type, front, back, options } = candidates[candidate]
        await updateCard(qc, card.id, type === 'cloze' ? { type, front } : { type, front, back, options })
      }
      const done: Record<OrphanAction, number> = { keep: 0, suspend: 0, unlink: 0, delete: 0 }
      for (const card of orphanChoices) {
        const action = orphanAction(card)
        if (action === 'delete') await deleteCard(qc, card.id)
        else await updateCard(qc, card.id, action === 'suspend' ? { suspended: true } : { noteId: null })
        done[action]++
      }
      const parts = [
        chosen.length ? `${chosen.length} erstellt` : '',
        changed.length ? `${changed.length} aktualisiert` : '',
        done.suspend ? `${done.suspend} ausgesetzt` : '',
        done.unlink ? `${done.unlink} von der Notiz gelöst` : '',
        done.delete ? `${done.delete} gelöscht` : '',
      ].filter(Boolean)
      const message =
        parts.length === 1 && chosen.length
          ? `${chosen.length} ${chosen.length === 1 ? 'Karte' : 'Karten'} erstellt.`
          : `Karten abgeglichen: ${parts.join(', ')}.`
      toast.show(message, {
        tone: 'success',
        duration: 6000,
        action: chosen.length
          ? { label: 'Jetzt lernen', onClick: () => app.go({ kind: 'study', scope: `note:${note.id}`, mode: 'learn' }) }
          : undefined,
      })
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const groups = SOURCES.map((source) => ({
    source,
    items: entries.map((c, i) => ({ c, i })).filter(({ c, i }) => c.source === source && !changedIndex.has(i)),
  })).filter((g) => g.items.length > 0)

  return (
    <Modal
      open
      onClose={onClose}
      title="Karteikarten aus Notiz"
      description={`„${note.title}“`}
      size="lg"
      footer={
        <>
          {error ? (
            <p className="mr-auto self-center text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
          <Button onClick={onClose}>Abbrechen</Button>
          {entries.length > 0 || sync.orphaned.length > 0 ? (
            <Button variant="primary" onClick={() => void submit()} loading={saving} disabled={total === 0} data-testid="create-from-note">
              {total === effective.size ? `${effective.size} ${effective.size === 1 ? 'Karte' : 'Karten'} erstellen` : 'Übernehmen'}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => {
                onClose()
                app.openCardEditor({ noteId: note.id, deckName: note.title })
              }}
            >
              <Plus className="size-4" /> Karte selbst anlegen
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {groups.length > 0 ? (
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
                {(id) => <Input id={id} value={deckName} onChange={(e) => setDeckName(e.target.value)} maxLength={200} />}
              </Field>
            ) : null}
          </div>
        ) : entries.length === 0 ? (
          <p className="rounded-xl bg-subtle px-4 py-3 text-sm">In dieser Notiz wurden keine Karten erkannt.</p>
        ) : null}

        {sync.changed.length > 0 ? (
          <section className="rounded-xl border border-border" data-testid="cards-changed">
            <div className="flex items-center gap-2 px-3 py-2">
              <input
                type="checkbox"
                checked={effectiveUpdates.size === sync.changed.length}
                ref={(el) => {
                  if (el) el.indeterminate = effectiveUpdates.size > 0 && effectiveUpdates.size < sync.changed.length
                }}
                onChange={(e) => setUpdates(new Set(e.target.checked ? sync.changed.map((c) => c.candidate) : []))}
                aria-label="Alle geänderten Karten aktualisieren"
                className="size-4 accent-[var(--accent)]"
              />
              <button
                type="button"
                onClick={() => setChangedOpen((o) => !o)}
                className="flex flex-1 items-center gap-1 text-left text-sm font-medium hover:underline"
                aria-expanded={changedOpen}
              >
                Geändert
                <span className="text-faint">({sync.changed.length})</span>
                <span className="ml-auto text-faint">{changedOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</span>
              </button>
            </div>
            {changedOpen ? (
              <ul className="max-h-96 divide-y divide-border overflow-y-auto border-t border-border">
                {sync.changed.map(({ candidate, card, exact }) => {
                  const next = candidates[candidate]
                  const parts = changedParts(card, next).map((p) => (p === 'front' && next.type === 'cloze' && exact ? 'Lücken' : PART_LABELS[p]))
                  const on = effectiveUpdates.has(candidate)
                  return (
                    <li key={card.id}>
                      <label className={cn('flex cursor-pointer gap-3 px-3 py-2.5 hover:bg-hover', !on && 'opacity-70')}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(e) => {
                            const n = new Set(effectiveUpdates)
                            if (e.target.checked) n.add(candidate)
                            else n.delete(candidate)
                            setUpdates(n)
                          }}
                          aria-label={`„${next.front}“ aktualisieren`}
                          className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
                        />
                        <span className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                          <span className="min-w-0" data-testid="card-before">
                            <span className="text-xs font-medium text-faint">Bisher</span>
                            <CardText card={card} />
                          </span>
                          <span className="min-w-0" data-testid="card-after">
                            <span className="text-xs font-medium text-faint">In der Notiz</span>
                            <CardText card={next} />
                          </span>
                          <span className="flex flex-wrap gap-1.5 sm:col-span-2">
                            {parts.length ? <Badge tone="accent">{parts.join(' und ')} geändert</Badge> : null}
                            {exact ? null : <Badge tone="warning">Vorschlag – ähnliche Frage</Badge>}
                          </span>
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            ) : null}
            <p className="border-t border-border px-3 py-2 text-xs text-muted">Aktualisieren übernimmt die Fassung aus der Notiz, der Lernstand bleibt.</p>
          </section>
        ) : null}

        {sync.orphaned.length > 0 ? (
          <section className="rounded-xl border border-border" data-testid="cards-orphaned">
            <div className="flex flex-wrap items-center gap-2 px-3 py-2">
              <h3 className="flex-1 text-sm font-medium">
                Nicht mehr in der Notiz <span className="text-faint">({sync.orphaned.length})</span>
              </h3>
              {sync.orphaned.length > 1 ? (
                <Select
                  value=""
                  onChange={(e) => {
                    const action = e.target.value as OrphanAction
                    setOrphanActions(Object.fromEntries(sync.orphaned.map((c) => [c.id, action])))
                  }}
                  aria-label="Für alle"
                  className="h-9! w-auto! text-sm!"
                >
                  <option value="" disabled>
                    Für alle …
                  </option>
                  {ORPHAN_ACTIONS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </Select>
              ) : null}
            </div>
            <p className="border-t border-border px-3 py-2 text-xs text-muted">
              Diese Karten stammen aus der Notiz, haben dort aber kein Gegenstück – etwa weil der Abschnitt gelöscht wurde. Von Hand
              angelegte Karten erscheinen hier auch; sie kannst du behalten.
            </p>
            <ul className="max-h-72 divide-y divide-border overflow-y-auto border-t border-border">
              {sync.orphaned.map((card) => (
                <li key={card.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <CardText card={card} />
                    {card.suspended ? (
                      <span className="mt-1 flex">
                        <Badge>Ausgesetzt</Badge>
                      </span>
                    ) : null}
                  </span>
                  <Select
                    value={orphanAction(card)}
                    onChange={(e) => setOrphanActions((a) => ({ ...a, [card.id]: e.target.value as OrphanAction }))}
                    aria-label={`„${card.front}“: was tun?`}
                    className="h-9! w-auto! text-sm!"
                  >
                    {ORPHAN_ACTIONS.map((a) => (
                      <option key={a.value} value={a.value}>
                        {a.label}
                      </option>
                    ))}
                  </Select>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <AiCardsPrompt note={note} existing={linkedFronts} suggested={aiDone} onCards={receiveSuggestions} />

        {groups.map(({ source, items }) => {
          const all = items.every(({ i }) => effective.has(i))
          const some = items.some(({ i }) => effective.has(i))
          const expanded = open.has(source)
          return (
            <section key={source} className="rounded-xl border border-border">
              <div className="flex items-center gap-2 px-3 py-2">
                <input
                  type="checkbox"
                  checked={all}
                  ref={(el) => {
                    if (el) el.indeterminate = some && !all
                  }}
                  onChange={(e) => toggle(items.map(({ i }) => i), e.target.checked)}
                  aria-label={`${LABELS[source]} auswählen`}
                  className="size-4 accent-[var(--accent)]"
                />
                <button
                  type="button"
                  onClick={() =>
                    setOpen((o) => {
                      const n = new Set(o)
                      if (n.has(source)) n.delete(source)
                      else n.add(source)
                      return n
                    })
                  }
                  className="flex flex-1 items-center gap-1 text-left text-sm font-medium hover:underline"
                  aria-expanded={expanded}
                >
                  {LABELS[source]}
                  <span className="text-faint">({items.length})</span>
                  <span className="ml-auto text-faint">{expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</span>
                </button>
              </div>
              {expanded ? (
                <ul className="max-h-72 divide-y divide-border overflow-y-auto border-t border-border">
                  {items.map(({ c, i }) => (
                    <li key={i}>
                      <label className={cn('flex cursor-pointer gap-3 px-3 py-2.5 hover:bg-hover', !effective.has(i) && 'opacity-70')}>
                        <input
                          type="checkbox"
                          checked={effective.has(i)}
                          onChange={(e) => toggle([i], e.target.checked)}
                          className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
                        />
                        <span className="min-w-0 flex-1">
                          <CardText card={c} />
                          <span className="mt-1 flex flex-wrap gap-1.5">
                            {c.type !== 'basic' ? <Badge>{CARD_TYPE_LABELS[c.type]}</Badge> : null}
                            {isDuplicate(i) ? <Badge tone="warning">Schon vorhanden</Badge> : null}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          )
        })}

        <div>
          <button
            type="button"
            onClick={() => setHelp((h) => !h)}
            aria-expanded={help}
            className="flex items-center gap-1 text-sm font-medium text-accent-text hover:underline"
          >
            {help ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            So schreibst du Karten in Notizen
          </button>
          {help ? (
            <div className="mt-2">
              <SyntaxHelp />
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  )
}
