'use client'
// Tresor entsperren: mit dem Passwort oder – vergessen – mit dem Wiederherstellungsschlüssel und einem neuen Passwort
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import { Modal } from '@/shared/ui/modal'
import { Button } from '@/shared/ui/button'
import { Field, Input } from '@/shared/ui/input'
import { ErrorText } from '@/shared/ui/toast'
import { api, errorMessage } from '@/shared/client/api'
import { rewrapWithPassword, VaultError } from '../crypto'
import { useVaultInfo, vault, vaultKey } from '../client/vault'
import type { VaultInfo } from '../types'
import { NewPasswordFields, newPasswordError } from './NewPasswordFields'

export function VaultUnlockDialog({ onClose, onUnlocked }: { onClose: () => void; onUnlocked: () => void }) {
  const qc = useQueryClient()
  const { data: info, isLoading, error: loadError } = useVaultInfo()
  const [recovery, setRecovery] = useState(false)
  const [password, setPassword] = useState('')
  const [recoveryKey, setRecoveryKey] = useState('')
  const [next, setNext] = useState({ password: '', repeat: '' })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // crypto.subtle gibt es nur über HTTPS (und auf localhost)
  const insecure = typeof crypto === 'undefined' || !crypto.subtle

  async function unlockWithRecovery(current: VaultInfo) {
    const pwError = newPasswordError(next.password, next.repeat)
    if (pwError) throw new Error(pwError)
    // Mit dem Wiederherstellungsschlüssel öffnen und gleich mit dem neuen Passwort verpacken
    const rewrapped = await rewrapWithPassword(current, { recoveryKey }, next.password)
    try {
      const res = await api<{ vault: VaultInfo }>('/api/vault', {
        method: 'PUT',
        body: { revision: current.revision, ...rewrapped },
      })
      qc.setQueryData(vaultKey, res.vault)
      await vault.unlockWithRecoveryKey(res.vault, recoveryKey)
    } catch (err) {
      // Inzwischen auf einem anderen Gerät geändert: neu laden, dann noch einmal
      void qc.invalidateQueries({ queryKey: vaultKey })
      throw err
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!info) return
    setError(null)
    setLoading(true)
    try {
      if (recovery) await unlockWithRecovery(info)
      else await vault.unlockWithPassword(info, password)
      onUnlocked()
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
      title="Tresor entsperren"
      description={
        recovery
          ? 'Mit dem Wiederherstellungsschlüssel öffnest du den Tresor und legst ein neues Passwort fest.'
          : 'Die Notizen im Tresor werden nur in diesem Tab entschlüsselt.'
      }
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" type="submit" form="vault-unlock" loading={loading} disabled={!info || insecure}>
            <Lock className="size-4" /> Entsperren
          </Button>
        </>
      }
    >
      <form id="vault-unlock" onSubmit={submit} className="space-y-4">
        <ErrorText>
          {insecure
            ? new VaultError('insecure_context').message
            : loadError
              ? errorMessage(loadError)
              : !isLoading && !info
                ? 'Es gibt keinen Tresor.'
                : error}
        </ErrorText>
        {recovery ? (
          <>
            <Field label="Wiederherstellungsschlüssel" hint="Groß- und Kleinschreibung und Bindestriche sind egal.">
              {(id) => (
                <Input
                  id={id}
                  value={recoveryKey}
                  onChange={(e) => setRecoveryKey(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                  placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                  required
                  autoFocus
                />
              )}
            </Field>
            <NewPasswordFields
              password={next.password}
              repeat={next.repeat}
              onChange={(p, r) => setNext({ password: p, repeat: r })}
            />
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
        <button
          type="button"
          className="text-sm text-accent-text hover:underline"
          onClick={() => {
            setRecovery(!recovery)
            setError(null)
          }}
        >
          {recovery ? 'Doch mit dem Passwort entsperren' : 'Passwort vergessen? Wiederherstellungsschlüssel verwenden'}
        </button>
      </form>
    </Modal>
  )
}
