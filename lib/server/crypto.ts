import 'server-only'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getConfig } from './config'

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url')
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export function uuid(): string {
  return crypto.randomUUID()
}

let cachedKey: { source: string; key: Buffer } | null = null

/**
 * Schlüssel für die Verschlüsselung von MFA-Geheimnissen.
 * Entweder aus SECRET_KEY oder aus einer automatisch erzeugten Datei im Datenverzeichnis.
 */
function getKey(): Buffer {
  const { keyFile } = getConfig()
  const envKey = process.env.SECRET_KEY
  const source = envKey ? `env:${envKey}` : `file:${keyFile}`
  if (cachedKey?.source === source) return cachedKey.key

  let key: Buffer
  if (envKey) {
    key = crypto.createHash('sha256').update(envKey, 'utf8').digest()
  } else {
    if (fs.existsSync(keyFile)) {
      key = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'base64')
    } else {
      fs.mkdirSync(path.dirname(keyFile), { recursive: true })
      key = crypto.randomBytes(32)
      fs.writeFileSync(keyFile, key.toString('base64'), { mode: 0o600 })
    }
    if (key.length !== 32) throw new Error(`Ungültiger Schlüssel in ${keyFile}`)
  }
  cachedKey = { source, key }
  return key
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.')
}

export function decrypt(payload: string): string {
  const [version, iv, tag, ct] = payload.split('.')
  if (version !== 'v1' || !iv || !tag || !ct) throw new Error('Unbekanntes Verschlüsselungsformat')
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8')
}

/** Zufälliges, gut lesbares Passwort (ohne verwechselbare Zeichen). */
export function generatePassword(length = 16): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length]
  // In Vierergruppen für bessere Lesbarkeit
  return out.match(/.{1,4}/g)!.join('-')
}
