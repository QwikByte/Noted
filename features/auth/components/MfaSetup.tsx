'use client'
import { useState } from 'react'
import { Check, Copy, Smartphone } from 'lucide-react'
import { api, errorMessage } from '@/shared/client/api'
import { copyText } from '@/shared/client/clipboard'
import { Button } from '@/shared/ui/button'
import { Field, Input } from '@/shared/ui/input'
import { ErrorText } from '@/shared/ui/toast'

type SetupData = { secret: string; uri: string; qrDataUrl: string }

/** Einrichtung der Zwei-Faktor-Anmeldung per Authenticator-App (TOTP). */
export function MfaSetup({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const [data, setData] = useState<SetupData | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  async function start() {
    setError(null)
    setLoading(true)
    try {
      setData(await api<SetupData>('/api/account/mfa/setup', { method: 'POST' }))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await api('/api/account/mfa/enable', { method: 'POST', body: { code } })
      onDone()
    } catch (err) {
      setError(errorMessage(err))
      setCode('')
    } finally {
      setLoading(false)
    }
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <ErrorText>{error}</ErrorText>
        <div className="flex items-start gap-3 rounded-lg bg-subtle p-4 text-sm text-muted">
          <Smartphone className="mt-0.5 size-5 shrink-0 text-accent" />
          <p>
            Du brauchst eine Authenticator-App, z.&nbsp;B. <strong className="text-fg">Aegis</strong>,{' '}
            <strong className="text-fg">2FAS</strong>, <strong className="text-fg">Google</strong> oder{' '}
            <strong className="text-fg">Microsoft Authenticator</strong>, <strong className="text-fg">1Password</strong> oder{' '}
            <strong className="text-fg">Bitwarden</strong>.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={start} loading={loading}>
            Einrichtung starten
          </Button>
          {onCancel ? <Button onClick={onCancel}>Abbrechen</Button> : null}
        </div>
      </div>
    )
  }

  const grouped = data.secret.match(/.{1,4}/g)?.join(' ') ?? data.secret

  return (
    <form onSubmit={confirm} className="space-y-5">
      <ErrorText>{error}</ErrorText>
      <ol className="space-y-5 text-sm">
        <li className="space-y-3">
          <p>
            <span className="font-semibold">1.</span> Scanne den QR-Code mit deiner Authenticator-App.
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={data.qrDataUrl} alt="QR-Code für die Authenticator-App" width={200} height={200} className="rounded-lg border border-border bg-white p-2" />
            <div className="w-full min-w-0 space-y-2 text-muted">
              <p>Oder gib den Schlüssel manuell ein:</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 rounded-lg bg-subtle px-3 py-2 font-mono text-[13px] break-all text-fg">{grouped}</code>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Schlüssel kopieren"
                  onClick={async () => {
                    await copyText(data.secret)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  }}
                >
                  {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
                </Button>
              </div>
              <a href={data.uri} className="inline-block text-accent-text underline sm:hidden">
                Direkt in der Authenticator-App öffnen
              </a>
            </div>
          </div>
        </li>
        <li className="space-y-2">
          <p>
            <span className="font-semibold">2.</span> Gib den angezeigten Code ein.
          </p>
          <Field label="Code">
            {(id) => (
              <Input
                id={id}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^\d\s]/g, '').slice(0, 7))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123 456"
                required
                className="h-12 max-w-48 text-center font-mono text-xl tracking-[0.25em]"
              />
            )}
          </Field>
        </li>
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" loading={loading} disabled={code.replace(/\s/g, '').length < 6}>
          Aktivieren
        </Button>
        {onCancel ? <Button onClick={onCancel}>Abbrechen</Button> : null}
      </div>
    </form>
  )
}
