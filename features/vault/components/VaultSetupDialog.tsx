'use client'
// Tresor einrichten: Passwort festlegen, Wiederherstellungsschlüssel sichern und bestätigen – erst dann geht das
// verpackte Schlüsselmaterial an den Server
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/shared/ui/modal'
import { Button } from '@/shared/ui/button'
import { Field, Input } from '@/shared/ui/input'
import { ErrorText, useToast } from '@/shared/ui/toast'
import { api, errorMessage } from '@/shared/client/api'
import { keys } from '@/features/notes/client/queries'
import { createVaultMaterial } from '../crypto'
import { normalizeCrockford } from '../format'
import { vault, vaultKey } from '../client/vault'
import type { VaultInfo, VaultMaterial } from '../types'
import { NewPasswordFields, newPasswordError } from './NewPasswordFields'
import { RecoveryKeyActions } from './RecoveryKeyActions'

/** Was der Tresor schützt und was nicht – beim Einrichten und in der README */
const EXPLANATION =
  'Notizen im Tresor werden in deinem Browser verschlüsselt, bevor sie den Server erreichen. Ohne dein ' +
  'Tresor-Passwort kann sie niemand lesen – auch nicht der Admin oder wer eine Sicherung der Datenbank hat. ' +
  'Vergisst du Passwort und Wiederherstellungsschlüssel, sind sie verloren. Nicht geschützt bist du, wenn der ' +
  'Server absichtlich verändert wurde oder dein Gerät Schadsoftware hat. Suche, Tags, Rückverweise, Teilen und ' +
  'Karteikarten funktionieren im Tresor nicht.'

type Created = { material: VaultMaterial; recoveryKey: string; key: CryptoKey; group: number }

export function VaultSetupDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [step, setStep] = useState<'password' | 'key' | 'confirm'>('password')
  const [pw, setPw] = useState({ password: '', repeat: '' })
  const [created, setCreated] = useState<Created | null>(null)
  const [group, setGroup] = useState('')
  const [stored, setStored] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submitPassword() {
    const pwError = newPasswordError(pw.password, pw.repeat)
    if (pwError) return setError(pwError)
    setLoading(true)
    try {
      const result = await createVaultMaterial(pw.password)
      setCreated({ ...result, group: Math.floor(Math.random() * 8) })
      setPw({ password: '', repeat: '' })
      setStep('key')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  async function submitConfirm() {
    if (!created) return
    const expected = created.recoveryKey.split('-')[created.group]
    if (normalizeCrockford(group) !== expected) return setError('Die Gruppe stimmt nicht – sieh noch einmal nach.')
    if (!stored) return setError('Bestätige, dass du den Wiederherstellungsschlüssel sicher aufbewahrt hast.')
    setLoading(true)
    try {
      const res = await api<{ vault: VaultInfo }>('/api/vault', { method: 'POST', body: created.material })
      qc.setQueryData(vaultKey, res.vault)
      vault.unlockWithKey(created.key)
      void qc.invalidateQueries({ queryKey: keys.folders })
      toast.success('Tresor eingerichtet. Er liegt als Ordner „Tresor“ in deinen Notizen.')
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (step === 'password') void submitPassword()
    else if (step === 'key') setStep('confirm')
    else void submitConfirm()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Tresor einrichten"
      description={`Schritt ${step === 'password' ? 1 : step === 'key' ? 2 : 3} von 3`}
      footer={
        <>
          {step === 'confirm' ? <Button onClick={() => setStep('key')}>Zurück</Button> : null}
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" type="submit" form="vault-setup" loading={loading}>
            {step === 'confirm' ? 'Tresor anlegen' : 'Weiter'}
          </Button>
        </>
      }
    >
      <form id="vault-setup" onSubmit={submit} className="space-y-4">
        <ErrorText>{error}</ErrorText>
        {step === 'password' ? (
          <>
            <p className="text-sm text-muted">{EXPLANATION}</p>
            <NewPasswordFields
              label="Tresor-Passwort"
              password={pw.password}
              repeat={pw.repeat}
              onChange={(password, repeat) => setPw({ password, repeat })}
            />
          </>
        ) : step === 'key' && created ? (
          <>
            <p className="text-sm">
              Das ist dein <strong>Wiederherstellungsschlüssel</strong>. Ohne ihn sind die Notizen im Tresor verloren,
              wenn du das Passwort vergisst. Drucke ihn aus oder speichere ihn außerhalb von Noted.
            </p>
            <RecoveryKeyActions recoveryKey={created.recoveryKey} />
          </>
        ) : created ? (
          <>
            <Field label={`${created.group + 1}. Gruppe deines Wiederherstellungsschlüssels`}>
              {(id) => (
                <Input
                  id={id}
                  value={group}
                  onChange={(e) => setGroup(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono uppercase"
                  maxLength={6}
                  required
                  autoFocus
                />
              )}
            </Field>
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
        ) : null}
      </form>
    </Modal>
  )
}
