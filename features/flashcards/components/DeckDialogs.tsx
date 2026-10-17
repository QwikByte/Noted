'use client'
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Field, Input, Switch } from '@/shared/ui/input'
import { Modal } from '@/shared/ui/modal'
import { Button } from '@/shared/ui/button'
import { useToast } from '@/shared/ui/toast'
import { AutoTextarea } from './CardEditor'
import { CARD_TYPE_LABELS, createCards, createDeck, importAnki, updateDeck } from '../client/flashcards'
import { attachmentsKey } from '@/features/attachments/client/queries'
import { errorMessage } from '@/shared/client/api'
import { parseCardsFromNote } from '../card-markdown'
import { DEFAULT_NEW_PER_DAY } from '../srs'
import type { AnkiImportResult, Deck } from '../types'

/** Neuen Stapel anlegen oder Name, Beschreibung, Tageslimit und „Antwort eintippen“ ändern. */
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
  const [typeAnswer, setTypeAnswer] = useState(deck?.typeAnswer ?? false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit() {
    const newPerDay = Number(limit)
    if (!name.trim()) return setError('Bitte gib einen Namen ein.')
    if (!Number.isInteger(newPerDay) || newPerDay < 0 || newPerDay > 9999) return setError('Das Tageslimit muss zwischen 0 und 9999 liegen.')
    setSaving(true)
    try {
      const input = { name: name.trim(), description, newPerDay, typeAnswer }
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
        <Switch
          checked={typeAnswer}
          onChange={setTypeAnswer}
          label="Antwort eintippen"
          description="Bei Grund- und beidseitigen Karten tippst du die Antwort ein, bevor sie aufgedeckt wird. Unterschiede zur richtigen Antwort werden markiert."
        />
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
  const parsed = useMemo(
    () => parseCardsFromNote(text, { tabs: true }).filter((c) => c.source === 'syntax' || c.source === 'cloze'),
    [text],
  )

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

/** Anki-Paket (.apkg) importieren – Stapel, Karten, Bilder und auf Wunsch der Lernstand */
export function AnkiImportDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AnkiImportResult | null>(null)

  async function submit() {
    if (!file) return setError('Bitte wähle eine Datei aus.')
    setBusy(true)
    setError(null)
    try {
      setResult(await importAnki(qc, file, progress))
      void qc.invalidateQueries({ queryKey: attachmentsKey })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Anki-Deck importieren"
      footer={
        result ? (
          <Button variant="primary" onClick={onClose}>
            Fertig
          </Button>
        ) : (
          <>
            {error ? <p className="mr-auto self-center text-sm text-danger">{error}</p> : null}
            <Button onClick={onClose}>Abbrechen</Button>
            <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={!file} data-testid="anki-import">
              Importieren
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-2 text-sm" data-testid="anki-result">
          <p>
            <strong>{result.cards.toLocaleString('de-DE')}</strong> {result.cards === 1 ? 'Karte' : 'Karten'} importiert
            {result.decks ? `, ${result.decks} ${result.decks === 1 ? 'neuer Stapel' : 'neue Stapel'}` : ''}
            {result.media ? `, ${result.media} ${result.media === 1 ? 'Datei' : 'Dateien'} unter Anhänge` : ''}.
          </p>
          {result.skipped.length ? (
            <div>
              <p className="text-muted">Übersprungen:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
                {result.skipped.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Exportiere das Deck in Anki über <em>Datei → Exportieren</em> als „Anki-Deck-Paket (.apkg)“. Stapel und Unterstapel,
            Grund-, beidseitige und Lückentext-Karten, Formeln, Bilder und Töne werden übernommen; Karten, die es im Stapel schon
            gibt, kommen nicht doppelt.
          </p>
          <Field label="Datei">
            {(id) => (
              <Input
                id={id}
                type="file"
                accept=".apkg,.colpkg"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="py-2"
                data-testid="anki-file"
              />
            )}
          </Field>
          <Switch
            checked={progress}
            onChange={setProgress}
            label="Lernstand übernehmen"
            description="Fälligkeiten, ausgesetzte Karten und alle bisherigen Bewertungen (für die Statistik) aus Anki."
          />
        </div>
      )}
    </Modal>
  )
}
