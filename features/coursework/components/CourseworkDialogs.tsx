'use client'
import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { addDays, dateOf, timeOf } from '@/features/calendar/dates'
import { Button } from '@/shared/ui/button'
import { Field, Input } from '@/shared/ui/input'
import { ConfirmModal, Modal } from '@/shared/ui/modal'
import { errorMessage } from '@/shared/client/api'
import { useCourseworkMutations, type DatedSheet } from '../client/coursework'
import { MAX_COURSE_NAME, MAX_POINTS, MAX_SHEET_TITLE, MAX_SHEETS_PER_COURSE } from '../limits'
import type { Course } from '../types'

/** Zahl aus einem Eingabefeld – auch mit Komma („7,5“); leer = null */
function parseNumber(value: string): number | null {
  const v = value.trim().replace(',', '.')
  return v === '' ? null : Number(v)
}

const DeleteButton = ({ onClick, disabled }: { onClick: () => void; disabled: boolean }) => (
  <Button variant="ghost" className="mr-auto text-danger hover:text-danger" onClick={onClick} disabled={disabled}>
    <Trash2 className="size-4" /> Löschen
  </Button>
)

/** Neues Fach anlegen oder ein vorhandenes ändern */
export function CourseDialog({ course, onClose }: { course: Course | null; onClose: () => void }) {
  const m = useCourseworkMutations()
  const [name, setName] = useState(course?.name ?? '')
  const [percent, setPercent] = useState(String(course?.requiredPercent ?? 50))
  const [planned, setPlanned] = useState(course?.plannedSheets ? String(course.plannedSheets) : '')
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const busy = m.createCourse.isPending || m.updateCourse.isPending

  async function save() {
    const requiredPercent = parseNumber(percent)
    const plannedSheets = parseNumber(planned)
    if (!name.trim()) return setError('Bitte gib einen Namen ein.')
    if (requiredPercent === null || !(requiredPercent >= 0 && requiredPercent <= 100)) {
      return setError('Die Quote muss zwischen 0 und 100 % liegen.')
    }
    if (plannedSheets !== null && !(Number.isInteger(plannedSheets) && plannedSheets >= 1 && plannedSheets <= MAX_SHEETS_PER_COURSE)) {
      return setError(`Die Zahl der Blätter muss zwischen 1 und ${MAX_SHEETS_PER_COURSE} liegen.`)
    }
    const input = { name, requiredPercent, plannedSheets }
    try {
      if (course) await m.updateCourse.mutateAsync({ id: course.id, input })
      else await m.createCourse.mutateAsync(input)
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function remove() {
    if (!course) return
    try {
      await m.deleteCourse.mutateAsync(course.id)
      onClose()
    } catch (err) {
      setConfirmDelete(false)
      setError(errorMessage(err))
    }
  }

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={course ? 'Fach bearbeiten' : 'Neues Fach'}
        footer={
          <>
            {course ? <DeleteButton onClick={() => setConfirmDelete(true)} disabled={busy} /> : null}
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
          <Field label="Name">
            {(id) => (
              <Input
                id={id}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={MAX_COURSE_NAME}
                placeholder="z. B. Analysis I"
                autoFocus={!course}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nötige Quote (%)" hint="Anteil der Übungspunkte für die Zulassung">
              {(id) => <Input id={id} type="number" inputMode="decimal" min={0} max={100} value={percent} onChange={(e) => setPercent(e.target.value)} />}
            </Field>
            <Field label="Blätter im Semester" hint="Optional – sonst zählen nur die angelegten">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_SHEETS_PER_COURSE}
                  value={planned}
                  onChange={(e) => setPlanned(e.target.value)}
                  placeholder="z. B. 12"
                />
              )}
            </Field>
          </div>
          {error ? (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" hidden />
        </form>
      </Modal>
      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Fach löschen?"
        description={`„${course?.name}“ wird mit allen Übungsblättern gelöscht – auch ihre Abgabetermine im Kalender.`}
        confirmLabel="Löschen"
        danger
        loading={m.deleteCourse.isPending}
        onConfirm={() => void remove()}
      />
    </>
  )
}

/** Vorgaben für das nächste Blatt: fortlaufender Titel, Punkte und Abgabe eine Woche nach dem letzten Blatt */
function nextSheet(sheets: DatedSheet[]): { title: string; date: string; time: string; maxPoints: string } {
  const last = sheets.at(-1)
  const due = last?.due ? addDays(dateOf(last.due), 7) : ''
  return {
    title: `Blatt ${sheets.length + 1}`,
    date: due,
    time: last?.due && last.due.length > 10 ? timeOf(last.due) : '',
    maxPoints: last ? String(last.maxPoints) : '',
  }
}

/** Übungsblatt anlegen oder ändern – auch die erreichten Punkte nach der Korrektur */
export function SheetDialog({
  course,
  sheet,
  sheets,
  onClose,
}: {
  course: Course
  sheet: DatedSheet | null
  /** Die Blätter des Fachs (für die Vorgaben eines neuen Blatts) */
  sheets: DatedSheet[]
  onClose: () => void
}) {
  const m = useCourseworkMutations()
  const [initial] = useState(() =>
    sheet
      ? {
          title: sheet.title,
          date: sheet.due ? dateOf(sheet.due) : '',
          time: sheet.due && sheet.due.length > 10 ? timeOf(sheet.due) : '',
          maxPoints: String(sheet.maxPoints),
        }
      : nextSheet(sheets),
  )
  const [title, setTitle] = useState(initial.title)
  const [date, setDate] = useState(initial.date)
  const [time, setTime] = useState(initial.time)
  const [maxPoints, setMaxPoints] = useState(initial.maxPoints)
  const [points, setPoints] = useState(sheet?.points != null ? String(sheet.points) : '')
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const busy = m.createSheet.isPending || m.updateSheet.isPending

  async function save() {
    const max = parseNumber(maxPoints)
    const got = parseNumber(points)
    if (!title.trim()) return setError('Bitte gib einen Titel ein.')
    if (max === null || !(max > 0 && max <= MAX_POINTS)) return setError(`Die erreichbaren Punkte müssen zwischen 0 und ${MAX_POINTS} liegen.`)
    if (got !== null && !(got >= 0 && got <= MAX_POINTS)) return setError('Bitte gib gültige erreichte Punkte an.')
    if (time && !date) return setError('Bitte gib zur Uhrzeit auch den Tag der Abgabe an.')
    const input = { title, maxPoints: max, points: got, due: date ? (time ? `${date}T${time}` : date) : null }
    try {
      if (sheet) await m.updateSheet.mutateAsync({ id: sheet.id, input })
      else await m.createSheet.mutateAsync({ courseId: course.id, input })
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function remove() {
    if (!sheet) return
    try {
      await m.deleteSheet.mutateAsync(sheet.id)
      onClose()
    } catch (err) {
      setConfirmDelete(false)
      setError(errorMessage(err))
    }
  }

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={sheet ? 'Übungsblatt bearbeiten' : 'Neues Übungsblatt'}
        description={course.name}
        footer={
          <>
            {sheet ? <DeleteButton onClick={() => setConfirmDelete(true)} disabled={busy} /> : null}
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
          <Field label="Titel">
            {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={MAX_SHEET_TITLE} />}
          </Field>
          <div className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-1.5">
            <Field label="Abgabe" hint="Erscheint als Termin im Kalender – leer lassen für keine">
              {(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
            </Field>
            <Field label="Uhrzeit">
              {(id) => <Input id={id} type="time" className="w-32" value={time} onChange={(e) => setTime(e.target.value)} />}
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Erreichbare Punkte">
              {(id) => (
                <Input id={id} type="number" inputMode="decimal" min={0} step={0.5} value={maxPoints} onChange={(e) => setMaxPoints(e.target.value)} />
              )}
            </Field>
            <Field label="Erreichte Punkte" hint="Leer, solange nicht korrigiert">
              {(id) => (
                <Input id={id} type="number" inputMode="decimal" min={0} step={0.5} value={points} onChange={(e) => setPoints(e.target.value)} />
              )}
            </Field>
          </div>
          {error ? (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" hidden />
        </form>
      </Modal>
      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Übungsblatt löschen?"
        description={`„${sheet?.title}“ wird gelöscht – auch der Abgabetermin im Kalender.`}
        confirmLabel="Löschen"
        danger
        loading={m.deleteSheet.isPending}
        onConfirm={() => void remove()}
      />
    </>
  )
}
