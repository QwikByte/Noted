'use client'
import { useState } from 'react'
import { ArrowLeft, KeyRound, ShieldCheck } from 'lucide-react'
import { api, clearCachedData, errorMessage, ApiError } from '@/lib/client/api'
import { Button } from '../ui/button'
import { Field, Input } from '../ui/input'
import { ErrorText } from '../ui/toast'

type LoginResponse = { status: 'ok' | 'mfa'; setup?: 'password' | 'mfa' | null }

export function LoginForm({ next, mfaPending }: { next: string; mfaPending: boolean }) {
  const [step, setStep] = useState<'password' | 'mfa'>(mfaPending ? 'mfa' : 'password')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function finish(res: LoginResponse) {
    await clearCachedData()
    location.href = res.setup ? '/setup' : next
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await api<LoginResponse>('/api/auth/login', { method: 'POST', body: { username, password } })
      if (res.status === 'mfa') {
        setStep('mfa')
        setPassword('')
        setLoading(false)
      } else await finish(res)
    } catch (err) {
      setError(errorMessage(err))
      setLoading(false)
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await finish(await api<LoginResponse>('/api/auth/mfa', { method: 'POST', body: { code } }))
    } catch (err) {
      setLoading(false)
      setCode('')
      if (err instanceof ApiError && ['too_many_attempts', 'no_mfa_pending', 'mfa_not_enabled'].includes(err.code)) {
        setStep('password')
      }
      setError(errorMessage(err))
    }
  }

  if (step === 'mfa') {
    return (
      <form onSubmit={submitCode} className="space-y-5">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <ShieldCheck className="size-5 text-accent-text" /> Bestätigungscode
          </h2>
          <p className="mt-1 text-sm text-muted">Gib den 6-stelligen Code aus deiner Authenticator-App ein.</p>
        </div>
        <ErrorText>{error}</ErrorText>
        <Field label="Code">
          {(id) => (
            <Input
              id={id}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^\d\s]/g, '').slice(0, 7))}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]*"
              placeholder="123 456"
              autoFocus
              required
              className="h-14 text-center font-mono text-2xl tracking-[0.3em]"
            />
          )}
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading} disabled={code.replace(/\s/g, '').length < 6}>
          Bestätigen
        </Button>
        <button
          type="button"
          onClick={async () => {
            await api('/api/auth/logout', { method: 'POST' }).catch(() => {})
            setStep('password')
            setError(null)
            setCode('')
          }}
          className="mx-auto flex items-center gap-1.5 text-sm text-muted hover:text-fg"
        >
          <ArrowLeft className="size-4" /> Mit anderem Konto anmelden
        </button>
        <p className="text-center text-xs text-faint">
          Kein Zugriff auf deine App? Der Administrator kann die Zwei-Faktor-Anmeldung zurücksetzen.
        </p>
      </form>
    )
  }

  return (
    <form onSubmit={submitPassword} className="space-y-5">
      <ErrorText>{error}</ErrorText>
      <Field label="Benutzername">
        {(id) => (
          <Input
            id={id}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            required
          />
        )}
      </Field>
      <Field label="Passwort">
        {(id) => (
          <Input
            id={id}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        )}
      </Field>
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
        <KeyRound className="size-4.5" /> Anmelden
      </Button>
      <p className="text-center text-xs text-faint">Konten werden vom Administrator angelegt.</p>
    </form>
  )
}
