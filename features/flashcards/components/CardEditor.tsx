'use client'
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Brackets, CheckSquare, Eye, FileText, PenLine, Plus, Square, X } from 'lucide-react'
import type { CardEditorInit } from '@/features/workspace/client/context'
import { CardMarkdown } from './CardMarkdown'
import { Button } from '@/shared/ui/button'
import { Field, Input, Select } from '@/shared/ui/input'
import { Modal } from '@/shared/ui/modal'
import { useToast } from '@/shared/ui/toast'
import { cn } from '@/shared/ui/cn'
import { CARD_TYPE_LABELS, createCards, createDeck, updateCard, useFlashcards, type CardInput } from '../client/flashcards'
import { usePref } from '@/shared/client/prefs'
import { useNotes } from '@/features/notes/client/queries'
import { errorMessage } from '@/shared/client/api'
import { parseCardsFromNote } from '../card-markdown'
import { MAX_OPTIONS } from '../limits'
import { clozeCount, clozeQuestion, hasCloze, normalizeCloze } from '../cloze'
import { occlusionError } from '../occlusion'
import { OcclusionImage } from './Occlusion'
import { OcclusionFields } from './OcclusionFields'
import type { CardOption, CardType, Occlusion } from '../types'

const NEW_DECK = '__new__'

/** Mehrzeiliges Eingabefeld, das mit dem Inhalt wächst. */
export const AutoTextarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number }
>(function AutoTextarea({ className, minRows = 2, ...props }, forwarded) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(forwarded, () => ref.current!)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      el.style.height = 'auto'
      if (el.scrollHeight > 0) el.style.height = `${Math.min(el.scrollHeight + 2, 420)}px`
    }
    fit()
    // Im gerade erst geöffneten Dialog ist noch nichts gelayoutet (Höhe 0) – im nächsten Frame nachmessen
    if (el.scrollHeight === 0) {
      const frame = requestAnimationFrame(fit)
      return () => cancelAnimationFrame(frame)
    }
  }, [props.value])
  return (
    <textarea
      ref={ref}
      rows={minRows}
      className={cn(
        'w-full resize-none rounded-xl border border-border bg-elevated px-3.5 py-2.5 text-[15px] leading-relaxed text-fg outline-none transition placeholder:text-faint focus:border-accent focus:ring-3 focus:ring-accent/15',
        className,
      )}
      {...props}
    />
  )
})

function TypeSwitch({ value, onChange }: { value: CardType; onChange: (t: CardType) => void }) {
  return (
    <div className="grid grid-cols-2 gap-0.5 rounded-xl bg-subtle p-1 sm:flex" role="radiogroup" aria-label="Kartentyp">
      {(['basic', 'reversed', 'cloze', 'mc', 'occlusion'] as CardType[]).map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={value === t}
          onClick={() => onChange(t)}
          className={cn(
            'h-8 flex-1 rounded-lg px-2 text-sm whitespace-nowrap transition-colors',
            value === t ? 'bg-elevated font-medium text-fg shadow-sm' : 'text-muted hover:text-fg',
          )}
        >
          {CARD_TYPE_LABELS[t]}
        </button>
      ))}
    </div>
  )
}

function emptyOptions(): CardOption[] {
  return [
    { text: '', correct: true },
    { text: '', correct: false },
    { text: '', correct: false },
  ]
}

/** Prüft eine Karte wie der Server – liefert eine Fehlermeldung oder null. */
function validateCard(c: Pick<CardInput, 'type' | 'front' | 'back' | 'options' | 'occlusion'>): string | null {
  if (c.type === 'occlusion') {
    if (!c.occlusion) return 'Bitte wähle ein Bild.'
    return occlusionError(c.occlusion) ?? (c.front.trim() ? null : 'Bitte gib einen Titel ein.')
  }
  if (!c.front.trim()) return 'Bitte gib eine Frage bzw. Vorderseite ein.'
  if (c.type === 'mc') {
    const filled = c.options.filter((o) => o.text.trim())
    if (filled.length < 2) return 'Multiple Choice braucht mindestens zwei Antworten.'
    if (!filled.some((o) => o.correct)) return 'Markiere mindestens eine richtige Antwort.'
  } else if (c.type === 'cloze') {
    if (!hasCloze(c.front)) return 'Markiere mindestens eine Lücke – Text auswählen und „Als Lücke“, oder ==Begriff== schreiben.'
  } else if (!c.back.trim()) return 'Bitte gib eine Antwort bzw. Rückseite ein.'
  return null
}

export function CardEditorDialog({ init, onClose }: { init: CardEditorInit; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { data } = useFlashcards()
  const { notes } = useNotes()
  const decks = data?.decks ?? []
  const editing = init.card
  const [lastDeck, setLastDeck] = usePref<string>('noted:lastDeck', '')

  const initialDeck =
    editing?.deckId ?? init.deckId ?? (decks.some((d) => d.id === lastDeck) ? lastDeck : (decks[0]?.id ?? NEW_DECK))
  const [deckId, setDeckId] = useState(initialDeck)
  const [deckName, setDeckName] = useState(init.deckName ?? '')
  const [type, setType] = useState<CardType>(editing?.type ?? init.type ?? 'basic')
  const [front, setFront] = useState(editing?.front ?? init.front ?? '')
  const [back, setBack] = useState(editing?.type === 'mc' ? editing.back : (editing?.back ?? init.back ?? ''))
  const [options, setOptions] = useState<CardOption[]>(
    editing?.type === 'mc' ? editing.options : init.options?.length ? init.options : emptyOptions(),
  )
  const [occlusion, setOcclusion] = useState<Occlusion | null>(editing?.occlusion ?? init.occlusion ?? null)
  const [noteId, setNoteId] = useState<string | null>(editing?.noteId ?? init.noteId ?? null)
  const [preview, setPreview] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const frontRef = useRef<HTMLTextAreaElement>(null)
  const optionRefs = useRef<(HTMLInputElement | null)[]>([])
  const focusOption = useRef<number | null>(null)
  const note = noteId ? notes.find((n) => n.id === noteId) : undefined

  // Stapel sind beim ersten Öffnen evtl. noch nicht geladen
  const [decksSeen, setDecksSeen] = useState(decks.length > 0)
  if (!decksSeen && decks.length > 0) {
    setDecksSeen(true)
    if (deckId === NEW_DECK && !editing && !init.deckId) setDeckId(decks.some((d) => d.id === lastDeck) ? lastDeck : decks[0].id)
  }

  useEffect(() => {
    if (focusOption.current !== null) {
      optionRefs.current[focusOption.current]?.focus()
      focusOption.current = null
    }
  }, [options.length])

  const setOption = (i: number, patch: Partial<CardOption>) =>
    setOptions((list) => list.map((o, k) => (k === i ? { ...o, ...patch } : o)))

  function addOption(focus = true) {
    if (options.length >= MAX_OPTIONS) return
    if (focus) focusOption.current = options.length
    setOptions((list) => [...list, { text: '', correct: false }])
  }

  async function save(next: boolean) {
    const card: CardInput = {
      type,
      front: front.trim(),
      back: back.trim(),
      options: type === 'mc' ? options.filter((o) => o.text.trim()).map((o) => ({ text: o.text.trim(), correct: o.correct })) : [],
      occlusion: type === 'occlusion' ? occlusion : null,
      noteId,
    }
    const invalid = validateCard(card)
    if (invalid) return setError(invalid)
    if (deckId === NEW_DECK && !deckName.trim()) return setError('Bitte gib einen Namen für den neuen Stapel ein.')
    setError(null)
    setSaving(true)
    try {
      let target = deckId
      if (target === NEW_DECK) {
        const deck = await createDeck(qc, { name: deckName.trim() })
        target = deck.id
        setDeckId(deck.id)
      }
      if (editing) {
        await updateCard(qc, editing.id, { ...card, deckId: target })
        toast.success('Karte gespeichert.')
        onClose()
        return
      }
      await createCards(qc, target, [card])
      setLastDeck(target)
      if (next) {
        toast.success('Karte gespeichert.')
        setFront('')
        setBack('')
        setOptions(emptyOptions())
        setOcclusion(null)
        setPreview(false)
        frontRef.current?.focus()
      } else {
        toast.success('Karte gespeichert.')
        onClose()
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const correctCount = options.filter((o) => o.correct && o.text.trim()).length

  /** Markierten Text der Vorderseite zur Lücke machen (==…==) */
  function markCloze() {
    const el = frontRef.current
    if (!el) return
    const { selectionStart: a, selectionEnd: b } = el
    if (a === b) {
      setError('Wähle zuerst den Text aus, der zur Lücke werden soll.')
      el.focus()
      return
    }
    const next = `${front.slice(0, a)}==${front.slice(a, b)}==${front.slice(b)}`
    setFront(next)
    setError(null)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(b + 4, b + 4)
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? 'Karte bearbeiten' : 'Neue Karteikarte'}
      size="lg"
      footer={
        <>
          {error ? (
            <p className="mr-auto self-center text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
          <Button onClick={onClose}>Abbrechen</Button>
          {!editing ? (
            <Button onClick={() => void save(true)} disabled={saving} title="Strg + Enter">
              Speichern & nächste
            </Button>
          ) : null}
          <Button variant="primary" onClick={() => void save(false)} loading={saving}>
            Speichern
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void save(!editing)
          }
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Stapel">
            {(id) => (
              <Select id={id} value={deckId} onChange={(e) => setDeckId(e.target.value)} data-testid="card-deck">
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
              {(id) => (
                <Input id={id} value={deckName} onChange={(e) => setDeckName(e.target.value)} placeholder="z. B. Analysis I" maxLength={200} />
              )}
            </Field>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <TypeSwitch value={type} onChange={setType} />
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setPreview((p) => !p)}
            aria-pressed={preview}
            title={preview ? 'Bearbeiten' : 'Vorschau'}
            aria-label={preview ? 'Bearbeiten' : 'Vorschau'}
          >
            {preview ? <PenLine className="size-4" /> : <Eye className="size-4" />}
          </Button>
        </div>

        {preview ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-border p-4">
              <p className="mb-2 text-xs font-semibold text-faint">
                {type === 'mc'
                  ? 'Frage'
                  : type === 'cloze'
                    ? `Lückentext (${clozeCount(normalizeCloze(front))} Lücken)`
                    : type === 'occlusion'
                      ? `Bildverdeckung (${occlusion?.masks.length ?? 0} Flächen)`
                      : 'Vorderseite'}
              </p>
              {front.trim() ? (
                <CardMarkdown text={type === 'cloze' ? clozeQuestion(normalizeCloze(front), 0) : front} />
              ) : (
                <p className="text-sm text-faint italic">Leer</p>
              )}
              {type === 'occlusion' && occlusion ? (
                <div className="mt-3">
                  <OcclusionImage occlusion={occlusion} side={0} revealed={false} />
                </div>
              ) : null}
            </div>
            {type === 'mc' ? (
              <ul className="space-y-1.5">
                {options
                  .filter((o) => o.text.trim())
                  .map((o, i) => (
                    <li key={i} className={cn('rounded-xl border px-3 py-2', o.correct ? 'border-success bg-success-soft' : 'border-border')}>
                      <CardMarkdown text={o.text} />
                    </li>
                  ))}
              </ul>
            ) : null}
            {back.trim() || (type !== 'mc' && type !== 'cloze' && type !== 'occlusion') ? (
              <div className="rounded-xl border border-border p-4">
                <p className="mb-2 text-xs font-semibold text-faint">
                  {type === 'mc' ? 'Erklärung' : type === 'cloze' || type === 'occlusion' ? 'Zusatz' : 'Rückseite'}
                </p>
                {back.trim() ? <CardMarkdown text={back} /> : <p className="text-sm text-faint italic">Leer</p>}
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <Field
              label={type === 'mc' ? 'Frage' : type === 'cloze' ? 'Text mit Lücken' : type === 'occlusion' ? 'Titel' : 'Vorderseite'}
              hint={
                type === 'cloze'
                  ? 'Jede Lücke wird einzeln abgefragt: Text auswählen und „Als Lücke“ – oder ==Begriff== bzw. {{Begriff}} schreiben.'
                  : type === 'occlusion'
                    ? 'Steht beim Lernen über dem Bild.'
                    : 'Markdown, $Formeln$, Bilder ![[…]] und Links wie [[Skript.pdf#page=3]] sind möglich.'
              }
            >
              {(id) => (
                <div className="space-y-1.5">
                  <AutoTextarea
                    id={id}
                    ref={frontRef}
                    value={front}
                    onChange={(e) => setFront(e.target.value)}
                    placeholder={
                      type === 'mc'
                        ? 'Welche Aussagen stimmen?'
                        : type === 'cloze'
                          ? 'Die Ableitung von ==sin x== ist ==cos x==.'
                          : type === 'occlusion'
                            ? 'z. B. Herz – Längsschnitt'
                            : 'Frage oder Begriff'
                    }
                    minRows={type === 'occlusion' ? 1 : 2}
                    autoFocus={!front}
                    data-testid="card-front"
                  />
                  {type === 'cloze' ? (
                    // Klick nimmt dem Textfeld die Auswahl nicht weg
                    <Button size="sm" onMouseDown={(e) => e.preventDefault()} onClick={markCloze}>
                      <Brackets className="size-4" /> Als Lücke
                    </Button>
                  ) : null}
                </div>
              )}
            </Field>

            {type === 'occlusion' ? (
              <OcclusionFields value={occlusion} onChange={setOcclusion} onImage={(title) => setFront((f) => f || title)} />
            ) : null}

            {type === 'mc' ? (
              <div className="space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">Antworten</span>
                  <span className="text-xs text-muted">
                    {correctCount === 1 ? 'Eine richtige Antwort (Einfachauswahl)' : `${correctCount} richtige Antworten`}
                  </span>
                </div>
                {options.map((o, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={o.correct}
                      aria-label={`Antwort ${i + 1} ist richtig`}
                      title={o.correct ? 'Richtig' : 'Falsch – klicken, um als richtig zu markieren'}
                      onClick={() => setOption(i, { correct: !o.correct })}
                      className={cn(
                        'flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors',
                        o.correct ? 'text-success hover:bg-success-soft' : 'text-faint hover:bg-hover hover:text-muted',
                      )}
                    >
                      {o.correct ? <CheckSquare className="size-5" /> : <Square className="size-5" />}
                    </button>
                    <Input
                      ref={(el) => {
                        optionRefs.current[i] = el
                      }}
                      value={o.text}
                      onChange={(e) => setOption(i, { text: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                          e.preventDefault()
                          if (i === options.length - 1) addOption()
                          else optionRefs.current[i + 1]?.focus()
                        }
                      }}
                      placeholder={`Antwort ${i + 1}`}
                      aria-label={`Antwort ${i + 1}`}
                      className={cn('h-10', o.correct && 'border-success/50')}
                      maxLength={2000}
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setOptions((list) => list.filter((_, k) => k !== i))}
                      disabled={options.length <= 2}
                      aria-label={`Antwort ${i + 1} entfernen`}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ))}
                {options.length < MAX_OPTIONS ? (
                  <Button variant="ghost" size="sm" onClick={() => addOption()}>
                    <Plus className="size-4" /> Antwort hinzufügen
                  </Button>
                ) : null}
              </div>
            ) : null}

            <Field
              label={
                type === 'mc'
                  ? 'Erklärung (optional)'
                  : type === 'cloze' || type === 'occlusion'
                    ? 'Zusatz (optional)'
                    : type === 'reversed'
                      ? 'Rückseite (wird auch als Frage gestellt)'
                      : 'Rückseite'
              }
            >
              {(id) => (
                <AutoTextarea
                  id={id}
                  value={back}
                  onChange={(e) => setBack(e.target.value)}
                  placeholder={
                    type === 'mc' ? 'Wird nach dem Prüfen angezeigt' : type === 'cloze' || type === 'occlusion' ? 'Wird nach dem Aufdecken angezeigt' : 'Antwort'
                  }
                  minRows={type === 'mc' || type === 'cloze' || type === 'occlusion' ? 1 : 3}
                  data-testid="card-back"
                />
              )}
            </Field>
          </>
        )}

        {noteId ? (
          <div className="flex items-center gap-2 rounded-xl bg-subtle px-3 py-2 text-sm text-muted">
            <FileText className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              Aus Notiz: <span className="font-medium text-fg">{note?.title ?? 'gelöschte Notiz'}</span>
            </span>
            <Button variant="ghost" size="sm" onClick={() => setNoteId(null)}>
              Verknüpfung lösen
            </Button>
          </div>
        ) : null}
        {editing ? null : (
          <p className="text-xs text-faint max-sm:hidden">
            <kbd className="rounded border border-border px-1">Strg</kbd> + <kbd className="rounded border border-border px-1">Enter</kbd>{' '}
            speichert und öffnet die nächste Karte.
          </p>
        )}
      </form>
    </Modal>
  )
}

/** Markierter Text → Karte: „Frage::Antwort“ o. Ä. wird erkannt, sonst wird die Markierung zur Vorderseite. */
export function cardFromSelection(text: string): Pick<CardEditorInit, 'type' | 'front' | 'back' | 'options'> {
  const found = parseCardsFromNote(text).filter((c) => c.source !== 'heading')
  if (found.length === 1) {
    const { type, front, back, options } = found[0]
    return { type, front, back, options }
  }
  return { front: text.trim() }
}
