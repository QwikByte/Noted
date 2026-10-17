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
import { CARD_TYPE_LABELS, createCards, createDeck, useFlashcards } from '../client/flashcards'
import { usePref } from '@/shared/client/prefs'
import { errorMessage } from '@/shared/client/api'
import { EXPLICIT_SOURCES, SOURCE_LABELS, parseCardsFromNote, type CandidateSource } from '../card-markdown'

const NEW_DECK = '__new__'
const SOURCES: CandidateSource[] = ['syntax', 'question', 'definition', 'bold', 'heading']
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

function SyntaxHelp() {
  return (
    <div className="space-y-2 text-sm text-muted">
      <p>Schreib Karten direkt in deine Notizen – kompatibel mit dem Obsidian-Plugin „Spaced Repetition“:</p>
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
  const isDuplicate = (i: number) => existing.has(norm(candidates[i].front))

  const [selected, setSelected] = useState<Set<number> | null>(null)
  // Vorauswahl: eindeutige Karten – oder die übergebenen Abschnitte (z. B. die beim Abfragen nicht gewussten)
  const preselect = useMemo(() => (note.preselect ? new Set(note.preselect) : null), [note.preselect])
  const effective = useMemo(() => {
    if (selected) return selected
    const wanted = (c: (typeof candidates)[number]) =>
      preselect ? c.source === 'heading' && preselect.has(c.line) : EXPLICIT_SOURCES.includes(c.source)
    return new Set(candidates.map((c, i) => (wanted(c) && !existing.has(norm(c.front)) ? i : -1)).filter((i) => i >= 0))
  }, [selected, candidates, existing, preselect])
  const [open, setOpen] = useState<Set<CandidateSource>>(() => new Set(note.preselect ? ['heading'] : EXPLICIT_SOURCES))
  const [help, setHelp] = useState(candidates.length === 0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (indices: number[], on: boolean) => {
    const next = new Set(effective)
    for (const i of indices) {
      if (on) next.add(i)
      else next.delete(i)
    }
    setSelected(next)
  }

  async function submit() {
    const chosen = [...effective].sort((a, b) => a - b).map((i) => candidates[i])
    if (chosen.length === 0) return setError('Wähle mindestens eine Karte aus.')
    if (deckId === NEW_DECK && !deckName.trim()) return setError('Bitte gib einen Namen für den neuen Stapel ein.')
    setSaving(true)
    setError(null)
    try {
      const target = deckId === NEW_DECK ? (await createDeck(qc, { name: deckName.trim() })).id : deckId
      await createCards(
        qc,
        target,
        chosen.map(({ type, front, back, options }) => ({ type, front, back, options, noteId: note.id })),
      )
      setLastDeck(target)
      toast.show(`${chosen.length} ${chosen.length === 1 ? 'Karte' : 'Karten'} erstellt.`, {
        tone: 'success',
        duration: 6000,
        action: { label: 'Jetzt lernen', onClick: () => app.go({ kind: 'study', scope: `note:${note.id}`, mode: 'learn' }) },
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
    items: candidates.map((c, i) => ({ c, i })).filter(({ c }) => c.source === source),
  })).filter((g) => g.items.length > 0)

  return (
    <Modal
      open
      onClose={onClose}
      title="Karteikarten aus Notiz"
      description={`„${note.title}“ – die Karten bleiben mit der Notiz verknüpft.`}
      size="lg"
      footer={
        <>
          {error ? <p className="mr-auto self-center text-sm text-danger">{error}</p> : null}
          <Button onClick={onClose}>Abbrechen</Button>
          {candidates.length > 0 ? (
            <Button variant="primary" onClick={() => void submit()} loading={saving} disabled={effective.size === 0} data-testid="create-from-note">
              {effective.size} {effective.size === 1 ? 'Karte' : 'Karten'} erstellen
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
        {candidates.length > 0 ? (
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
        ) : (
          <p className="rounded-xl bg-subtle px-4 py-3 text-sm">In dieser Notiz wurden keine Karten erkannt.</p>
        )}

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
                  aria-label={`${SOURCE_LABELS[source]} auswählen`}
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
                  className="flex flex-1 items-center gap-1 text-left text-sm font-medium"
                  aria-expanded={expanded}
                >
                  {SOURCE_LABELS[source]}
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
                          <span className="line-clamp-2 text-sm font-medium whitespace-pre-line">{c.front}</span>
                          <span className="line-clamp-2 text-sm whitespace-pre-line text-muted">
                            {c.type === 'mc' ? c.options.map((o) => (o.correct ? `✓ ${o.text}` : o.text)).join(' · ') : c.back}
                          </span>
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
          <button type="button" onClick={() => setHelp((h) => !h)} className="flex items-center gap-1 text-sm font-medium text-accent-text">
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
