'use client'
import { useState } from 'react'
import { FilePlus2, FileText, Repeat, Trash2 } from 'lucide-react'
import { useApp } from '@/features/workspace/client/context'
import { useNotes } from '@/features/notes/client/queries'
import { Button } from '@/shared/ui/button'
import { Field, Input, Select, Switch } from '@/shared/ui/input'
import { Modal } from '@/shared/ui/modal'
import { useToast } from '@/shared/ui/toast'
import { cn } from '@/shared/ui/cn'
import { errorMessage } from '@/shared/client/api'
import { noteTitleFor } from '../agenda'
import { addDays, addMinutes, dateOf, daysBetween, longDate, minutesBetween, timeOf, weekdayName } from '../dates'
import { applyToSeries, eventError } from '../event'
import { MAX_LOCATION, MAX_NOTES, MAX_TITLE } from '../limits'
import { useEventMutations } from '../client/calendar'
import type { EventColor, EventInput, Occurrence } from '../types'

/** Neuer Termin mit Vorgaben oder ein vorhandener (bei Serien: das angeklickte Vorkommen) */
export type DialogTarget = { kind: 'new'; input: EventInput } | { kind: 'edit'; occurrence: Occurrence }

const COLORS: { id: EventColor; label: string }[] = [
  { id: 1, label: 'Rot' },
  { id: 2, label: 'Orange' },
  { id: 3, label: 'Gelb' },
  { id: 4, label: 'Grün' },
  { id: 5, label: 'Türkis' },
  { id: 6, label: 'Lila' },
]

/** Farbe eines Termins für style – ohne eigene Farbe die Akzentfarbe */
export const eventColor = (color: EventColor | null) => (color ? `var(--swatch-${color})` : 'var(--accent)')

type Draft = {
  title: string
  location: string
  notes: string
  color: EventColor | null
  allDay: boolean
  startDate: string
  startTime: string
  /** Bei ganztägigen Terminen der letzte Tag (einschließlich) */
  endDate: string
  endTime: string
  /** 0 = keine Wiederholung */
  weeks: number
  /** Leer = ohne Ende */
  until: string
}

function toDraft(e: EventInput): Draft {
  return {
    title: e.title,
    location: e.location,
    notes: e.notes,
    color: e.color,
    allDay: e.allDay,
    startDate: dateOf(e.start),
    startTime: e.allDay ? '09:00' : timeOf(e.start),
    endDate: e.allDay ? addDays(e.end, -1) : dateOf(e.end),
    endTime: e.allDay ? '10:00' : timeOf(e.end),
    weeks: e.repeat?.weeks ?? 0,
    until: e.repeat?.until ?? '',
  }
}

function toInput(d: Draft, exdates: string[]): EventInput {
  return {
    title: d.title,
    location: d.location,
    notes: d.notes,
    color: d.color,
    allDay: d.allDay,
    start: d.allDay ? d.startDate : `${d.startDate}T${d.startTime}`,
    end: d.allDay ? (d.endDate ? addDays(d.endDate, 1) : '') : `${d.endDate}T${d.endTime}`,
    repeat: d.weeks > 0 ? { weeks: d.weeks, until: d.until || null } : null,
    exdates,
  }
}

/** Beginn verschieben und das Ende mitnehmen – die Dauer bleibt gleich */
function moveStart(d: Draft, patch: Partial<Pick<Draft, 'startDate' | 'startTime'>>): Draft {
  const next = { ...d, ...patch }
  if (!next.startDate || (!d.allDay && !next.startTime) || !d.endDate) return next
  if (d.allDay) return { ...next, endDate: addDays(next.startDate, Math.max(0, daysBetween(d.startDate, d.endDate))) }
  const length = minutesBetween(`${d.startDate}T${d.startTime}`, `${d.endDate}T${d.endTime}`)
  if (!Number.isFinite(length) || length < 0) return next
  const end = addMinutes(`${next.startDate}T${next.startTime}`, length)
  return { ...next, endDate: dateOf(end), endTime: timeOf(end) }
}

export function EventDialog({ target, onClose }: { target: DialogTarget; onClose: () => void }) {
  const toast = useToast()
  const m = useEventMutations()
  const occurrence = target.kind === 'edit' ? target.occurrence : null
  const series = occurrence?.event.repeat ? occurrence.event : null
  // Bei Serien gilt eine Änderung zunächst nur für den angeklickten Termin
  const [scope, setScope] = useState<'one' | 'all'>('one')
  const [draft, setDraft] = useState(() =>
    toDraft(target.kind === 'edit' ? { ...target.occurrence.event, start: target.occurrence.start, end: target.occurrence.end } : target.input),
  )
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setError(null)
  }

  const onlyThis = series !== null && scope === 'one'
  const busy = m.create.isPending || m.update.isPending || m.occurrence.isPending || m.remove.isPending

  async function save() {
    const input = toInput(onlyThis ? { ...draft, weeks: 0 } : draft, occurrence?.event.exdates ?? [])
    const payload = series && occurrence && !onlyThis ? applyToSeries(series, occurrence, input) : input
    const problem = eventError(payload)
    if (problem) return setError(problem)
    try {
      if (!occurrence) await m.create.mutateAsync(payload)
      else if (onlyThis) await m.occurrence.mutateAsync({ id: occurrence.event.id, date: occurrence.date, input: payload })
      else await m.update.mutateAsync({ id: occurrence.event.id, input: payload })
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function remove(which: 'one' | 'all') {
    if (!occurrence) return
    try {
      if (which === 'one' && series) await m.occurrence.mutateAsync({ id: series.id, date: occurrence.date, input: null })
      else await m.remove.mutateAsync(occurrence.event.id)
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={occurrence ? 'Termin bearbeiten' : 'Neuer Termin'}
        description={occurrence ? `${weekdayName(occurrence.date)}, ${longDate(occurrence.date)}${series ? ' · wiederholt sich' : ''}` : undefined}
        footer={
          <>
            {occurrence ? (
              <Button variant="ghost" className="mr-auto text-danger hover:text-danger" onClick={() => setConfirmDelete(true)} disabled={busy}>
                <Trash2 className="size-4" /> Löschen
              </Button>
            ) : null}
            <Button onClick={onClose}>Abbrechen</Button>
            <Button variant="primary" onClick={() => void save()} loading={busy}>
              Speichern
            </Button>
          </>
        }
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          {series ? (
            <div className="flex rounded-xl bg-subtle p-1" role="radiogroup" aria-label="Änderung gilt für">
              {(
                [
                  ['one', 'Nur dieser Termin'],
                  ['all', 'Alle Termine'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={scope === value}
                  onClick={() => setScope(value)}
                  className={cn(
                    'flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                    scope === value ? 'bg-elevated text-fg shadow-sm' : 'text-muted hover:text-fg',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}

          <Field label="Titel">
            {(id) => (
              <Input
                id={id}
                value={draft.title}
                onChange={(e) => set({ title: e.target.value })}
                maxLength={MAX_TITLE}
                placeholder="z. B. Analysis I"
                autoFocus={!occurrence}
              />
            )}
          </Field>

          <Switch checked={draft.allDay} onChange={(allDay) => set({ allDay })} label="Ganztägig" />

          <div className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-3">
            <Field label={draft.allDay ? 'Erster Tag' : 'Beginn'}>
              {(id) => (
                <Input id={id} type="date" value={draft.startDate} onChange={(e) => setDraft(moveStart(draft, { startDate: e.target.value }))} />
              )}
            </Field>
            {draft.allDay ? <div /> : (
              <Field label="Uhrzeit">
                {(id) => (
                  <Input
                    id={id}
                    type="time"
                    className="w-32"
                    value={draft.startTime}
                    onChange={(e) => setDraft(moveStart(draft, { startTime: e.target.value }))}
                  />
                )}
              </Field>
            )}
            <Field label={draft.allDay ? 'Letzter Tag' : 'Ende'}>
              {(id) => <Input id={id} type="date" value={draft.endDate} onChange={(e) => set({ endDate: e.target.value })} />}
            </Field>
            {draft.allDay ? <div /> : (
              <Field label="Uhrzeit">
                {(id) => (
                  <Input id={id} type="time" className="w-32" value={draft.endTime} onChange={(e) => set({ endTime: e.target.value })} />
                )}
              </Field>
            )}
          </div>

          {onlyThis ? null : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Wiederholung">
                {(id) => (
                  <Select id={id} value={draft.weeks} onChange={(e) => set({ weeks: Number(e.target.value) })}>
                    <option value={0}>Keine</option>
                    <option value={1}>Jede Woche{draft.startDate ? ` (${weekdayName(draft.startDate)})` : ''}</option>
                    <option value={2}>Alle 2 Wochen</option>
                    <option value={3}>Alle 3 Wochen</option>
                    <option value={4}>Alle 4 Wochen</option>
                  </Select>
                )}
              </Field>
              {draft.weeks > 0 ? (
                <Field label="Bis einschließlich" hint="Leer lassen für ohne Ende">
                  {(id) => <Input id={id} type="date" value={draft.until} min={draft.startDate} onChange={(e) => set({ until: e.target.value })} />}
                </Field>
              ) : null}
            </div>
          )}

          <Field label="Ort">
            {(id) => (
              <Input
                id={id}
                value={draft.location}
                onChange={(e) => set({ location: e.target.value })}
                maxLength={MAX_LOCATION}
                placeholder="z. B. Hörsaal 1"
              />
            )}
          </Field>

          <div className="space-y-1.5">
            <span className="block text-sm font-medium">Farbe</span>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Farbe">
              {[{ id: null, label: 'Standard' }, ...COLORS].map((c) => (
                <button
                  key={c.id ?? 0}
                  type="button"
                  role="radio"
                  aria-checked={draft.color === c.id}
                  aria-label={c.label}
                  title={c.label}
                  onClick={() => set({ color: c.id })}
                  className={cn(
                    'size-7 rounded-full ring-offset-2 ring-offset-elevated transition',
                    draft.color === c.id ? 'ring-2 ring-fg' : 'hover:scale-110',
                  )}
                  style={{ background: eventColor(c.id) }}
                />
              ))}
            </div>
          </div>

          <Field label="Notizen">
            {(id) => (
              <textarea
                id={id}
                rows={3}
                value={draft.notes}
                maxLength={MAX_NOTES}
                onChange={(e) => set({ notes: e.target.value })}
                className="w-full resize-y rounded-lg border border-border-strong/70 bg-elevated px-3.5 py-2.5 text-[15px] text-fg outline-none transition placeholder:text-faint focus:border-accent focus:ring-3 focus:ring-accent/20"
              />
            )}
          </Field>

          {occurrence && !occurrence.event.allDay ? <NoteLink occurrence={occurrence} onDone={onClose} /> : null}

          {error ? (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
          {/* Enter im Formular speichert */}
          <button type="submit" hidden />
        </form>
      </Modal>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        size="sm"
        title={series ? 'Wiederkehrenden Termin löschen?' : 'Termin löschen?'}
        description={series ? undefined : `„${occurrence?.event.title}“ wird gelöscht.`}
        footer={
          series ? (
            <>
              <Button onClick={() => setConfirmDelete(false)}>Abbrechen</Button>
              <Button variant="danger" onClick={() => void remove('all')} loading={m.remove.isPending}>
                Alle Termine
              </Button>
              <Button variant="danger" onClick={() => void remove('one')} loading={m.occurrence.isPending}>
                Nur diesen
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => setConfirmDelete(false)}>Abbrechen</Button>
              <Button variant="danger" onClick={() => void remove('all')} loading={m.remove.isPending}>
                Löschen
              </Button>
            </>
          )
        }
      >
        {series && occurrence ? (
          <p className="flex items-start gap-2 text-sm text-muted">
            <Repeat className="mt-0.5 size-4 shrink-0" />
            Nur den Termin am {weekdayName(occurrence.date)}, {longDate(occurrence.date)} – oder die ganze Serie „{series.title}“?
          </p>
        ) : null}
      </Modal>
    </>
  )
}

/** Mitschrift zum Termin öffnen oder mit der Vorlage „Vorlesung“ anlegen */
function NoteLink({ occurrence, onDone }: { occurrence: Occurrence; onDone: () => void }) {
  const app = useApp()
  const { notes } = useNotes()
  const title = noteTitleFor(occurrence)
  const note = notes.find((n) => n.title.toLowerCase() === title.toLowerCase())
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-sm text-muted">Mitschrift „{title}“</span>
      {note ? (
        <Button
          size="sm"
          onClick={() => {
            onDone()
            app.go({ kind: 'note', id: note.id })
          }}
        >
          <FileText className="size-4" /> Öffnen
        </Button>
      ) : (
        <Button
          size="sm"
          onClick={() => {
            onDone()
            app.openNewNote({ templateId: 'lecture', title })
          }}
        >
          <FilePlus2 className="size-4" /> Anlegen
        </Button>
      )}
    </div>
  )
}
