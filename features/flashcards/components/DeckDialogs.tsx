'use client'
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Field, Input } from '@/shared/ui/input'
import { Modal } from '@/shared/ui/modal'
import { Button } from '@/shared/ui/button'
import { useToast } from '@/shared/ui/toast'
import { AutoTextarea } from './CardEditor'
import { CARD_TYPE_LABELS, createCards, createDeck, updateDeck } from '../client/flashcards'
import { errorMessage } from '@/shared/client/api'
import { parseCardsFromNote } from '../card-markdown'
import { DEFAULT_NEW_PER_DAY } from '../srs'
import type { Deck } from '../types'

/** Neuen Stapel anlegen oder Name, Beschreibung und Tageslimit ändern. */
export function DeckSettingsDialog({
  deck,
  onClose,
  onSaved,
}: {
  deck?: Deck
  onClose: () => void
  onSaved?: (deck: Deck) => void
}) {
  const qc = useQueryClient()
  const [name, setName] = useState(deck?.name ?? '')
  const [description, setDescription] = useState(deck?.description ?? '')
  const [limit, setLimit] = useState(String(deck?.newPerDay ?? DEFAULT_NEW_PER_DAY))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit() {
    const newPerDay = Number(limit)
    if (!name.trim()) return setError('Bitte gib einen Namen ein.')
    if (!Number.isInteger(newPerDay) || newPerDay < 0 || newPerDay > 9999) return setError('Das Tageslimit muss zwischen 0 und 9999 liegen.')
    setSaving(true)
    try {
      const input = { name: name.trim(), description, newPerDay }
      const saved = deck ? await updateDeck(qc, deck.id, input) : await createDeck(qc, input)
      onSaved?.(saved)
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={deck ? 'Stapel bearbeiten' : 'Neuer Stapel'}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={() => void submit()} loading={saving}>
            {deck ? 'Speichern' : 'Anlegen'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Field label="Name" error={error}>
          {(id) => (
            <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Analysis I" autoFocus maxLength={200} />
          )}
        </Field>
        <Field label="Beschreibung (optional)">
          {(id) => <AutoTextarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} minRows={2} />}
        </Field>
        <Field label="Neue Karten pro Tag" hint="So viele noch nie gelernte Karten kommen im Lernmodus täglich höchstens dazu. Üben geht immer mit allen Karten.">
          {(id) => <Input id={id} type="number" inputMode="numeric" min={0} max={9999} value={limit} onChange={(e) => setLimit(e.target.value)} className="w-32" />}
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

/** Viele Karten auf einmal: eine pro Zeile (Frage::Antwort oder Tabulator) oder mehrzeilig wie in Notizen. */
export function ImportCardsDialog({ deck, onClose }: { deck: Deck; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const parsed = useMemo(() => parseCardsFromNote(text, { tabs: true }).filter((c) => c.source === 'syntax'), [text])

  async function submit() {
    if (parsed.length === 0) return setError('Keine Karten erkannt.')
    setSaving(true)
    try {
      await createCards(
        qc,
        deck.id,
        parsed.map(({ type, front, back, options }) => ({ type, front, back, options })),
      )
      toast.success(`${parsed.length} ${parsed.length === 1 ? 'Karte' : 'Karten'} importiert.`)
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Karten in „${deck.name}“ importieren`}
      size="lg"
      footer={
        <>
          {error ? <p className="mr-auto self-center text-sm text-danger">{error}</p> : null}
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={() => void submit()} loading={saving} disabled={parsed.length === 0}>
            {parsed.length > 0 ? `${parsed.length} ${parsed.length === 1 ? 'Karte' : 'Karten'} importieren` : 'Importieren'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="space-y-1 text-sm text-muted">
          <p>Eine Karte pro Zeile – Frage und Antwort getrennt durch <code className="rounded bg-subtle px-1">::</code> oder einen Tabulator (z. B. aus Quizlet, Anki oder einer Tabelle kopiert). <code className="rounded bg-subtle px-1">:::</code> erzeugt eine beidseitige Karte.</p>
          <p>Mehrzeilig: Frage, dann eine Zeile mit <code className="rounded bg-subtle px-1">?</code>, dann die Antwort; Karten durch Leerzeilen trennen. Multiple Choice: Antworten als Liste <code className="rounded bg-subtle px-1">- [x] richtig</code> / <code className="rounded bg-subtle px-1">- [ ] falsch</code>.</p>
        </div>
        <AutoTextarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          minRows={8}
          className="font-mono text-sm"
          placeholder={'Hauptstadt von Frankreich::Paris\nHaus:::house\n\nWelche Zahlen sind prim?\n?\n- [x] 2\n- [ ] 4\n- [x] 7'}
          aria-label="Karten"
          autoFocus
        />
        {parsed.length > 0 ? (
          <div className="rounded-xl border border-border">
            <p className="border-b border-border px-3 py-2 text-xs font-medium text-muted">Vorschau</p>
            <ul className="max-h-56 divide-y divide-border overflow-y-auto text-sm">
              {parsed.slice(0, 50).map((c, i) => (
                <li key={i} className="flex gap-3 px-3 py-2">
                  <span className="w-24 shrink-0 text-xs text-faint">{CARD_TYPE_LABELS[c.type]}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{c.front}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">
                    {c.type === 'mc' ? c.options.map((o) => (o.correct ? `✓ ${o.text}` : o.text)).join(' · ') : c.back}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
