import 'server-only'
import { randomBytes } from 'node:crypto'
import { hash, hashSync, verify, type Algorithm } from '@node-rs/argon2'

// OWASP-Empfehlung für Argon2id (19 MiB, 2 Iterationen)
const options = { algorithm: 2 as Algorithm /* Argon2id */, memoryCost: 19456, timeCost: 2, parallelism: 1 }

const PASSWORD_MIN_LENGTH = 10
const PASSWORD_MAX_LENGTH = 256

export function hashPassword(password: string): Promise<string> {
  return hash(password, options)
}

export function hashPasswordSync(password: string): string {
  return hashSync(password, options)
}

export async function verifyPassword(hashValue: string, password: string): Promise<boolean> {
  try {
    return await verify(hashValue, password)
  } catch {
    return false
  }
}

// Gültiger Hash eines zufälligen Passworts, damit unbekannte Benutzer genauso lange brauchen
let dummyHash: string | null = null
export async function verifyDummy(password: string): Promise<void> {
  dummyHash ??= await hashPassword(randomBytes(32).toString('base64'))
  await verifyPassword(dummyHash, password)
}

/** Liefert eine Fehlermeldung oder null, wenn das Passwort den Regeln entspricht. */
export function checkPasswordPolicy(password: string, username?: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Das Passwort muss mindestens ${PASSWORD_MIN_LENGTH} Zeichen lang sein.`
  if (password.length > PASSWORD_MAX_LENGTH) return `Das Passwort darf höchstens ${PASSWORD_MAX_LENGTH} Zeichen lang sein.`
  const name = username?.trim().toLowerCase()
  if (name && (password.toLowerCase() === name || (name.length >= 4 && password.toLowerCase().includes(name))))
    return 'Das Passwort darf den Benutzernamen nicht enthalten.'
  if (/^(.)\1+$/.test(password)) return 'Das Passwort ist zu einfach.'
  return null
}
