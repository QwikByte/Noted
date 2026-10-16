'use client'
import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { PasswordChangeForm } from './PasswordChangeForm'
import { MfaSetup } from './MfaSetup'
import { logout } from '@/lib/client/session'

/** Erzwungene Kontoeinrichtung: Startpasswort ändern und/oder MFA einrichten. */
export function SetupFlow({
  initialStep,
  displayName,
  needsMfa,
}: {
  initialStep: 'password' | 'mfa'
  displayName: string
  needsMfa: boolean
}) {
  const [step, setStep] = useState(initialStep)
  const steps = [...(initialStep === 'password' ? (['password'] as const) : []), ...(needsMfa ? (['mfa'] as const) : [])]
  const index = steps.indexOf(step as never) + 1

  return (
    <div className="space-y-5">
      <div>
        {steps.length > 1 ? (
          <p className="mb-1 text-sm font-medium text-accent-text">
            Schritt {index} von {steps.length}
          </p>
        ) : null}
        <h2 className="text-lg font-semibold">
          {step === 'password' ? `Willkommen, ${displayName}!` : 'Zwei-Faktor-Anmeldung einrichten'}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {step === 'password'
            ? 'Bitte ersetze dein Startpasswort durch ein eigenes, sicheres Passwort.'
            : 'Für dein Konto ist eine Zwei-Faktor-Anmeldung vorgeschrieben. Danach brauchst du beim Anmelden zusätzlich einen Code aus deiner Authenticator-App.'}
        </p>
      </div>
      {step === 'password' ? (
        <PasswordChangeForm
          submitLabel="Passwort festlegen"
          onDone={() => (needsMfa ? setStep('mfa') : (location.href = '/'))}
        />
      ) : (
        <MfaSetup onDone={() => (location.href = '/')} />
      )}
      <button type="button" onClick={() => logout()} className="flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <LogOut className="size-4" /> Abmelden
      </button>
    </div>
  )
}
