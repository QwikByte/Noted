'use client'
// Einstellungen → Tresor: einrichten, sperren, Passwort ändern, Wiederherstellungsschlüssel erneuern, automatisch
// sperren, löschen
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { KeyRound, Lock, LockOpen, RefreshCw, Trash2 } from 'lucide-react'
import { Section } from '@/shared/ui/sub-page'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Field, Input, Select } from '@/shared/ui/input'
import { Modal } from '@/shared/ui/modal'
import { ErrorText, useToast } from '@/shared/ui/toast'
import { api, errorMessage } from '@/shared/client/api'
import { usePref } from '@/shared/client/prefs'
import { keys } from '@/features/notes/client/queries'
import { sync } from '@/features/notes/client/sync'
import { renewRecoveryKey, rewrapWithPassword } from '../crypto'
import { AUTO_LOCK_MINUTES, AUTO_LOCK_PREF, useVaultInfo, useVaultState, vault, vaultKey } from '../client/vault'
import type { VaultInfo } from '../types'
import { NewPasswordFields, newPasswordError } from './NewPasswordFields'
import { RecoveryKeyActions } from './RecoveryKeyActions'
import { VaultSetupDialog } from './VaultSetupDialog'
import { VaultUnlockDialog } from './VaultUnlockDialog'

type Dialog = 'setup' | 'unlock' | 'password' | 'recovery' | 'delete'

const DELETE_PHRASE = 'Tresor löschen'

export function VaultSettings() {
  const { data: info, isLoading } = useVaultInfo()
  const { unlocked } = useVaultState()
  const [autoLock, setAutoLock] = usePref<string>(AUTO_LOCK_PREF, '15')
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const close = () => setDialog(null)

  return (
    <Section
      title="Tresor"
      description={
        'Notizen im Ordner „Tresor“ werden in deinem Browser verschlüsselt – mit einem eigenen Passwort, das der ' +
        'Server nie sieht.'
      }
    >
      {isLoading ? null : !info ? (
        <Button variant="primary" onClick={() => setDialog('setup')}>
          <Lock className="size-4" /> Tresor einrichten
        </Button>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            {unlocked ? <Badge tone="warning">Entsperrt in diesem Tab</Badge> : <Badge tone="success">Gesperrt</Badge>}
            {unlocked ? (
              <Button size="sm" onClick={() => void vault.lock()}>
                <Lock className="size-4" /> Sperren
              </Button>
            ) : (
              <Button size="sm" onClick={() => setDialog('unlock')}>
                <LockOpen className="size-4" /> Entsperren
              </Button>
            )}
          </div>
          <Field
            label="Automatisch sperren nach"
            hint="Ohne Eingabe in diesem Tab. Gilt nur für dieses Gerät."
            className="max-w-sm"
          >
            {(id) => (
              <Select id={id} value={autoLock} onChange={(e) => setAutoLock(e.target.value)}>
                {AUTO_LOCK_MINUTES.map((m) => (
                  <option key={m} value={m}>
                    {m} Minuten
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="flex flex-wrap gap-2 border-t border-border pt-5">
            <Button onClick={() => setDialog('password')}>
              <KeyRound className="size-4" /> Passwort ändern …
            </Button>
            <Button onClick={() => setDialog('recovery')}>
              <RefreshCw className="size-4" /> Wiederherstellungsschlüssel erneuern …
            </Button>
            <Button variant="ghost" className="text-danger" onClick={() => setDialog('delete')}>
              <Trash2 className="size-4" /> Tresor löschen …
            </Button>
          </div>
        </div>
      )}
      {dialog === 'setup' ? <VaultSetupDialog onClose={close} /> : null}
      {dialog === 'unlock' ? <VaultUnlockDialog onClose={close} onUnlocked={close} /> : null}
      {dialog === 'password' && info ? <ChangePasswordDialog info={info} onClose={close} /> : null}
      {dialog === 'recovery' && info ? <RenewRecoveryDialog info={info} onClose={close} /> : null}
      {dialog === 'delete' ? <DeleteVaultDialog onClose={close} /> : null}
    </Section>
  )
}

/** Neu verpacktes Schlüsselmaterial speichern – bei einer Änderung auf einem anderen Gerät den neuen Stand holen */
function useSaveKeys() {
  const qc = useQueryClient()
  return async (info: VaultInfo, patch: Partial<VaultInfo>) => {
    try {
      const res = await api<{ vault: VaultInfo }>('/api/vault', {
        method: 'PUT',
        body: { revision: info.revision, ...patch },
      })
      qc.setQueryData(vaultKey, res.vault)
    } catch (err) {
      void qc.invalidateQueries({ queryKey: vaultKey })
      throw err
    }
  }
}

function ChangePasswordDialog({ info, onClose }: { info: VaultInfo; onClose: () => void }) {
  const toast = useToast()
  const saveKeys = useSaveKeys()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState({ password: '', repeat: '' })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const pwError = newPasswordError(next.password, next.repeat)
    if (pwError) return setError(pwError)
    setError(null)
    setLoading(true)
    try {
      // Nur neu verpacken – die Notizen bleiben, wie sie sind
      await saveKeys(info, await rewrapWithPassword(info, { password: current }, next.password))
      toast.success('Tresor-Passwort geändert.')
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Tresor-Passwort ändern"
      description="Andere Geräte, die gerade offline sind, entsperren bis zur nächsten Verbindung noch mit dem alten."
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" type="submit" form="vault-password" loading={loading}>
            Ändern
          </Button>
        </>
      }
    >
      <form id="vault-password" onSubmit={submit} className="space-y-4">
        <ErrorText>{error}</ErrorText>
        <Field label="Bisheriges Tresor-Passwort">
          {(id) => (
            <Input
              id={id}
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="off"
              required
              autoFocus
            />
          )}
        </Field>
        <NewPasswordFields
          password={next.password}
          repeat={next.repeat}
          onChange={(password, repeat) => setNext({ password, repeat })}
        />
      </form>
    </Modal>
  )
}

function RenewRecoveryDialog({ info, onClose }: { info: VaultInfo; onClose: () => void }) {
  const toast = useToast()
  const saveKeys = useSaveKeys()
  const [password, setPassword] = useState('')
  const [renewed, setRenewed] = useState<Awaited<ReturnType<typeof renewRecoveryKey>> | null>(null)
  const [stored, setStored] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      if (!renewed) {
        setRenewed(await renewRecoveryKey(info, password))
        setPassword('')
        return
      }
      if (!stored) throw new Error('Bestätige, dass du den neuen Wiederherstellungsschlüssel sicher aufbewahrt hast.')
      // Erst jetzt gilt der neue Schlüssel – der alte nicht mehr
      await saveKeys(info, { recoverySalt: renewed.recoverySalt, recoveryWrappedKey: renewed.recoveryWrappedKey })
      toast.success('Neuer Wiederherstellungsschlüssel gilt. Der alte funktioniert nicht mehr.')
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Wiederherstellungsschlüssel erneuern"
      description="Der bisherige Schlüssel gilt danach nicht mehr."
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" type="submit" form="vault-recovery" loading={loading}>
            {renewed ? 'Neuen Schlüssel übernehmen' : 'Weiter'}
          </Button>
        </>
      }
    >
      <form id="vault-recovery" onSubmit={submit} className="space-y-4">
        <ErrorText>{error}</ErrorText>
        {renewed ? (
          <>
            <RecoveryKeyActions recoveryKey={renewed.recoveryKey} />
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={stored}
                onChange={(e) => setStored(e.target.checked)}
                className="mt-0.5 size-4 accent-[var(--accent)]"
              />
              Ich habe ihn sicher aufbewahrt.
            </label>
          </>
        ) : (
          <Field label="Tresor-Passwort">
            {(id) => (
              <Input
                id={id}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
                required
                autoFocus
              />
            )}
          </Field>
        )}
      </form>
    </Modal>
  )
}

function DeleteVaultDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [phrase, setPhrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (phrase.trim() !== DELETE_PHRASE) return setError(`Tippe „${DELETE_PHRASE}“ ein, um zu bestätigen.`)
    setError(null)
    setLoading(true)
    try {
      const res = await api<{ notes: number }>('/api/vault', { method: 'DELETE' })
      await vault.lock()
      // Ungesendete Änderungen an Tresor-Notizen gehen ins Leere
      for (const d of sync.getDrafts()) if (d.vault) sync.discard(d.id)
      qc.setQueryData(vaultKey, null)
      for (const queryKey of [keys.notes, keys.folders, keys.trash]) void qc.invalidateQueries({ queryKey })
      toast.success(`Tresor gelöscht – ${res.notes} ${res.notes === 1 ? 'Notiz' : 'Notizen'} entfernt.`)
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Tresor löschen?"
      description={
        'Alle Notizen im Tresor (auch im Papierkorb) samt Verlauf und alle Ordner darin werden endgültig gelöscht. ' +
        'Das lässt sich nicht rückgängig machen.'
      }
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="danger" type="submit" form="vault-delete" loading={loading}>
            Endgültig löschen
          </Button>
        </>
      }
    >
      <form id="vault-delete" onSubmit={submit} className="space-y-4">
        <ErrorText>{error}</ErrorText>
        <Field label={`Zur Bestätigung „${DELETE_PHRASE}“ eintippen`}>
          {(id) => (
            <Input id={id} value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" autoFocus />
          )}
        </Field>
      </form>
    </Modal>
  )
}
