'use client'
// Neues Tresor-Passwort zweimal eingeben – beim Einrichten, Ändern und nach dem Wiederherstellungsschlüssel
import { Field, Input } from '@/shared/ui/input'
import { MIN_VAULT_PASSWORD_LENGTH } from '../limits'

// Prüfen lässt sich das nicht, ohne das Tresor-Passwort an den Server zu schicken
const NOT_LOGIN = 'Nicht dein Anmeldepasswort.'

/** Fehlermeldung zum neuen Passwort – `null`, wenn es passt */
export function newPasswordError(password: string, repeat: string): string | null {
  if ([...password].length < MIN_VAULT_PASSWORD_LENGTH) {
    return (
      `Das Tresor-Passwort braucht mindestens ${MIN_VAULT_PASSWORD_LENGTH} Zeichen – ` +
      'am besten ein Satz aus mehreren Wörtern.'
    )
  }
  if (password !== repeat) return 'Die Passwörter stimmen nicht überein.'
  return null
}

export function NewPasswordFields({
  password,
  repeat,
  onChange,
  label = 'Neues Tresor-Passwort',
}: {
  password: string
  repeat: string
  onChange: (password: string, repeat: string) => void
  label?: string
}) {
  return (
    <>
      <Field
        label={label}
        hint={`Mindestens ${MIN_VAULT_PASSWORD_LENGTH} Zeichen, z. B. ein Satz aus mehreren Wörtern. ${NOT_LOGIN}`}
      >
        {(id) => (
          <Input
            id={id}
            type="password"
            value={password}
            onChange={(e) => onChange(e.target.value, repeat)}
            autoComplete="new-password"
            required
          />
        )}
      </Field>
      <Field label="Passwort wiederholen">
        {(id) => (
          <Input
            id={id}
            type="password"
            value={repeat}
            onChange={(e) => onChange(password, e.target.value)}
            autoComplete="new-password"
            required
          />
        )}
      </Field>
    </>
  )
}
