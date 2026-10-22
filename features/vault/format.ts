// Tresor: Format der verschlüsselten Felder und des Schlüsselmaterials (Version 1) – reine Logik für Server und
// Browser. Gespeichert werden nur Umschläge „nv1.<IV>.<Chiffretext‖Tag>“ und verpackte Schlüssel; der
// Tresor-Schlüssel selbst verlässt nie den Browser.
import { z } from 'zod'

export const VAULT_FORMAT = 1
/** PBKDF2-Iterationen: Standard und Minimum (OWASP Password Storage Cheat Sheet) – weniger wird beim Lesen abgelehnt */
export const KDF_MIN_ITERATIONS = 600_000
/** Name des Wurzelordners – bleibt als einziger Name im Tresor Klartext */
export const VAULT_FOLDER_NAME = 'Tresor'

/** Umschlag eines verschlüsselten Felds: 12 Bytes IV, mindestens das 16-Byte-Tag (beides base64url ohne Auffüllung) */
export const VAULT_ENVELOPE_RE = /^nv1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/

/** Verschlüsselte Felder – die AAD bindet den Chiffretext an Notiz bzw. Ordner und Feld */
export type VaultField = 'title' | 'content' | 'name'

/** Zusatzdaten (AAD) eines Felds – ohne Version, damit Verlauf und Wiederherstellen Chiffretext kopieren können */
export const aad = (id: string, field: VaultField) => utf8(`noted-vault/${VAULT_FORMAT}/${id}/${field}`)

/** Länge eines Umschlags für so viele Bytes Klartext */
export const envelopeLength = (bytes: number) => 21 + Math.ceil(((bytes + 16) * 4) / 3)

const SALT_RE = /^[A-Za-z0-9_-]{22}$/

/** Ableitung aus dem Passwort – die Parameter stehen im Tresor, damit ein späterer Umstieg nur neu verpackt */
export const kdfSchema = z.object({
  name: z.literal('PBKDF2-SHA-256'),
  iterations: z.number().int().min(KDF_MIN_ITERATIONS).max(100_000_000),
  salt: z.string().regex(SALT_RE),
})
export type VaultKdf = z.infer<typeof kdfSchema>

/** Base64url eines 16-Byte-Salts bzw. eines mit AES-KW verpackten 256-Bit-Schlüssels (40 Bytes) */
export const saltSchema = z.string().regex(SALT_RE)
export const wrappedKeySchema = z.string().regex(/^[A-Za-z0-9_-]{54}$/)

export function utf8(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text)
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]))

/** Base64url ohne Auffüllung – selbst geschrieben, weil `Uint8Array.toBase64` in Node 22 fehlt */
export function toBase64url(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
    if (i + 1 < bytes.length) out += B64[(n >> 6) & 63]
    if (i + 2 < bytes.length) out += B64[n & 63]
  }
  return out
}

/** Gegenstück zu `toBase64url` – `null` bei ungültigen Zeichen oder unmöglicher Länge */
export function fromBase64url(text: string): Uint8Array<ArrayBuffer> | null {
  if (text.length % 4 === 1) return null
  const out = new Uint8Array(Math.floor((text.length * 3) / 4))
  let bits = 0
  let value = 0
  let j = 0
  for (const c of text) {
    const v = B64_INDEX.get(c)
    if (v === undefined) return null
    value = (value << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[j++] = (value >> bits) & 255
    }
  }
  return out
}

// Crockford-Base32: ohne I, L, O, U – beim Lesen gelten O als 0 und I/L als 1, Groß/klein und Bindestriche sind egal
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Bytes als Crockford-Base32, in Vierergruppen mit Bindestrich (20 Bytes → 8 Gruppen) */
export function toCrockford(bytes: Uint8Array): string {
  let out = ''
  let value = 0
  let bits = 0
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      bits -= 5
      out += B32[(value >> bits) & 31]
    }
    value &= (1 << bits) - 1
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out.match(/.{1,4}/g)?.join('-') ?? ''
}

/** Gegenstück zu `toCrockford` – `null`, wenn ein Zeichen nicht passt oder die Länge nicht stimmt */
export function fromCrockford(text: string, length: number): Uint8Array<ArrayBuffer> | null {
  const clean = text.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  if (clean.length !== Math.ceil((length * 8) / 5)) return null
  const out = new Uint8Array(length)
  let value = 0
  let bits = 0
  let j = 0
  for (const c of clean) {
    const v = B32.indexOf(c)
    if (v < 0) return null
    value = (value << 5) | v
    bits += 5
    if (bits >= 8 && j < length) {
      bits -= 8
      out[j++] = (value >> bits) & 255
      value &= (1 << bits) - 1
    }
  }
  return out
}
