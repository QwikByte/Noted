'use client'
import { useState } from 'react'
import { api, errorMessage } from '@/lib/client/api'
import { Button } from '../ui/button'
import { Field, Input } from '../ui/input'
import { ErrorText } from '../ui/toast'

function passwordHint(pw: string): { label: string; tone: 'danger' | 'warning' | 'success'; score: number } {
  let score = 0
  if (pw.length >= 10) score++
  if (pw.length >= 14) score++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
  if (/\d/.test(pw)) score++
  if (/[^\w\s]/.test(pw) || /\s/.test(pw)) score++
  if (pw.length < 10) return { label: 'Zu kurz (mind. 10 Zeichen)', tone: 'danger', score: Math.min(score, 1) }
  if (score <= 2) return { label: 'Okay', tone: 'warning', score }
  return { label: 'Stark', tone: 'success', score }
}

function PasswordStrength({ password }: { password: string }) {
  if (!password) return null
  const h = passwordHint(password)
  const color = h.tone === 'danger' ? 'bg-danger' : h.tone === 'warning' ? 'bg-warning' : 'bg-success'
  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-1 gap-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className={`h-1 flex-1 rounded-full ${i < Math.max(1, h.score) ? color : 'bg-border'}`} />
        ))}
      </div>
      <span className="text-xs text-muted">{h.label}</span>
    </div>
  )
}

export function PasswordChangeForm({ onDone, submitLabel = 'Passwort ändern' }: { onDone: () => void; submitLabel?: string }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (next !== confirm) return setError('Die neuen Passwörter stimmen nicht überein.')
    setLoading(true)
    try {
      await api('/api/account/password', { method: 'POST', body: { currentPassword: current, newPassword: next } })
      setCurrent('')
      setNext('')
      setConfirm('')
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <ErrorText>{error}</ErrorText>
      <Field label="Aktuelles Passwort">
        {(id) => (
          <Input id={id} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        )}
      </Field>
      <Field label="Neues Passwort" hint="Mindestens 10 Zeichen. Eine Passphrase aus mehreren Wörtern ist ideal.">
        {(id) => (
          <div className="space-y-2">
            <Input id={id} type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required minLength={10} />
            <PasswordStrength password={next} />
          </div>
        )}
      </Field>
      <Field label="Neues Passwort wiederholen">
        {(id) => (
          <Input id={id} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        )}
      </Field>
      <Button type="submit" variant="primary" loading={loading} className="w-full sm:w-auto">
        {submitLabel}
      </Button>
    </form>
  )
}
