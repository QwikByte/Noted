'use client'
import { useEffect, useState } from 'react'
import { CalendarDays, Loader2, RefreshCw, Unplug } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { ConfirmModal } from '@/shared/ui/modal'
import { Section } from '@/shared/ui/sub-page'
import { useToast } from '@/shared/ui/toast'
import { errorMessage } from '@/shared/client/api'
import { connectCalendar, useCalendarMutations, useCalendarStatus } from '../client/calendar'

const DESCRIPTION = 'Termine aus deinem Microsoft-Kalender (Outlook) auf der Startseite. Noted liest sie nur und ändert nichts.'

/** Einstellungen → Kalender: verbinden, Kalender auswählen, trennen */
export function CalendarSettings() {
  const status = useCalendarStatus()
  const { select, disconnect } = useCalendarMutations()
  const toast = useToast()
  const [confirm, setConfirm] = useState(false)
  // Auswahl sofort zeigen, bis der Server sie bestätigt hat (bei einem Fehler gilt wieder der alte Stand)
  const [draft, setDraft] = useState<string[] | null>(null)

  // Rückkehr von der Microsoft-Anmeldung: /settings?kalender=verbunden|abgebrochen|fehler
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const result = params.get('kalender')
    if (!result) return
    if (result === 'verbunden') toast.success('Kalender verbunden.')
    else if (result === 'abgebrochen') toast.show('Verbinden abgebrochen.')
    else toast.error('Das Verbinden mit Microsoft hat nicht geklappt. Versuch es noch einmal.')
    params.delete('kalender')
    const query = params.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`)
  }, [toast])

  const connect = () => connectCalendar().catch((err) => toast.error(errorMessage(err)))
  const s = status.data

  return (
    <Section id="kalender" icon={<CalendarDays />} title="Kalender" description={DESCRIPTION}>
      {!s ? (
        <Loader2 className="size-5 animate-spin text-faint" />
      ) : !s.configured ? (
        <p className="text-sm text-muted">
          Auf diesem Server ist die Verbindung mit Microsoft nicht eingerichtet. Der Admin kann sie freischalten (siehe
          README, „Kalender verbinden“).
        </p>
      ) : !s.connected ? (
        <div className="space-y-3">
          <Button variant="primary" onClick={connect}>
            <CalendarDays className="size-4" /> Mit Microsoft verbinden
          </Button>
          <p className="text-xs text-muted">
            Bei Uni- oder Arbeitskonten verlangt Microsoft manchmal eine Freigabe durch die IT. Erscheint ein solcher
            Hinweis, kann nur sie helfen.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm">
            Verbunden als <span className="font-medium">{s.account.name || s.account.email}</span>
            {s.account.name && s.account.email ? <span className="text-muted"> ({s.account.email})</span> : null}
          </p>
          {s.error ? (
            <div className="space-y-3">
              <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">{s.error}</p>
              <Button size="sm" onClick={connect}>
                <RefreshCw className="size-4" /> Neu verbinden
              </Button>
            </div>
          ) : (
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Diese Kalender auf der Startseite zeigen</legend>
              <ul className="space-y-1">
                {s.calendars.map((c) => (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-hover">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--accent)]"
                        checked={draft ? draft.includes(c.id) : c.selected}
                        disabled={select.isPending}
                        onChange={(e) => {
                          const current = draft ?? s.calendars.filter((x) => x.selected).map((x) => x.id)
                          const ids = e.target.checked ? [...current, c.id] : current.filter((id) => id !== c.id)
                          setDraft(ids)
                          select.mutate(ids, {
                            onError: (err) => toast.error(errorMessage(err)),
                            onSettled: () => setDraft(null),
                          })
                        }}
                      />
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: c.color ?? 'var(--accent)' }} aria-hidden />
                      <span className="truncate">{c.name}</span>
                      {c.isDefault ? <span className="text-xs text-faint">Standard</span> : null}
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          <Button onClick={() => setConfirm(true)}>
            <Unplug className="size-4" /> Trennen
          </Button>
        </div>
      )}
      <ConfirmModal
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() =>
          disconnect.mutate(undefined, {
            onSuccess: () => {
              setConfirm(false)
              toast.success('Kalender getrennt.')
            },
            onError: (err) => toast.error(errorMessage(err)),
          })
        }
        title="Kalender trennen?"
        description="Noted löscht die gespeicherten Zugangsdaten. Die Freigabe für Noted kannst du zusätzlich in deinem Microsoft-Konto entfernen."
        confirmLabel="Trennen"
        danger
        loading={disconnect.isPending}
      />
    </Section>
  )
}
