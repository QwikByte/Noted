// Tresor: Schlüssel und Verschlüsselung – nur über WebCrypto (`globalThis.crypto.subtle`), läuft im Browser und in
// Node (Tests). Aufbau: Ein zufälliger Tresor-Schlüssel (AES-GCM 256) verschlüsselt die Felder; er liegt zweimal
// verpackt (AES-KW) beim Server – mit dem Schlüssel aus dem Passwort (PBKDF2) und mit dem aus dem
// Wiederherstellungsschlüssel (HKDF). Passwortwechsel heißt daher nur neu verpacken.
import {
  aad,
  fromBase64url,
  fromCrockford,
  KDF_MIN_ITERATIONS,
  kdfSchema,
  toBase64url,
  toCrockford,
  utf8,
  VAULT_ENVELOPE_RE,
  type VaultField,
  type VaultKdf,
} from './format'
import type { VaultInfo, VaultMaterial } from './types'

type Bytes = Uint8Array<ArrayBuffer>

const MESSAGES = {
  wrong_password: 'Das Passwort stimmt nicht.',
  wrong_recovery_key: 'Der Wiederherstellungsschlüssel stimmt nicht.',
  corrupt: 'Diese Notiz ist beschädigt oder wurde verändert und wird nicht angezeigt.',
  unsupported_kdf: 'Der Tresor nutzt ein unbekanntes oder zu schwaches Verfahren und lässt sich hier nicht öffnen.',
  insecure_context: 'Der Tresor braucht eine sichere Verbindung (HTTPS).',
  locked: 'Der Tresor ist gesperrt.',
}

type VaultErrorCode = keyof typeof MESSAGES

export class VaultError extends Error {
  constructor(public code: VaultErrorCode) {
    super(MESSAGES[code])
  }
}

/** Zum Entsperren beim Neu-Verpacken: Passwort oder Wiederherstellungsschlüssel */
type VaultSecret = { password: string } | { recoveryKey: string }

const RECOVERY_BYTES = 20
const RECOVERY_INFO = 'noted-vault/1/recovery'

// WebCrypto gibt es nur in sicheren Kontexten (HTTPS, localhost)
function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle
  if (!s) throw new VaultError('insecure_context')
  return s
}

const randomBytes = (n: number): Bytes => globalThis.crypto.getRandomValues(new Uint8Array(n))

/** PBKDF2-HMAC-SHA-256 über das NFC-normalisierte Passwort (zusammengesetztes und zerlegtes „Ä“ sind gleich) */
export async function pbkdf2(password: string, salt: Bytes, iterations: number, bytes = 32): Promise<Bytes> {
  const base = await subtle().importKey('raw', utf8(password.normalize('NFC')), 'PBKDF2', false, ['deriveBits'])
  const bits = await subtle().deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, bytes * 8)
  return new Uint8Array(bits)
}

/** HKDF-SHA-256 – für den Wiederherstellungsschlüssel genügt sie, er besteht aus 160 Bit Zufall */
export async function hkdf(ikm: Bytes, salt: Bytes, info: Bytes, bytes = 32): Promise<Bytes> {
  const base = await subtle().importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, base, bytes * 8))
}

/** Schlüssel zum Verpacken (AES-KW, RFC 3394) aus abgeleiteten Bytes */
export function importKek(bytes: Bytes): Promise<CryptoKey> {
  return subtle().importKey('raw', bytes, 'AES-KW', false, ['wrapKey', 'unwrapKey'])
}

/** AES-GCM mit 128-Bit-Tag: Chiffretext‖Tag */
export async function seal(key: CryptoKey, iv: Bytes, additionalData: Bytes, plaintext: Bytes): Promise<Bytes> {
  return new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData, tagLength: 128 }, key, plaintext))
}

async function open(key: CryptoKey, iv: Bytes, additionalData: Bytes, sealed: Bytes): Promise<Bytes> {
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv, additionalData, tagLength: 128 }, key, sealed))
}

/** Tresor-Schlüssel verpacken – dafür muss er kurzzeitig exportierbar sein (nur beim Anlegen und Neu-Verpacken) */
export async function wrapKey(kek: CryptoKey, key: CryptoKey): Promise<Bytes> {
  return new Uint8Array(await subtle().wrapKey('raw', key, kek, 'AES-KW'))
}

/** Verpackten Tresor-Schlüssel öffnen – im Normalfall nicht exportierbar, er bleibt nur im Arbeitsspeicher des Tabs */
async function unwrap(kek: CryptoKey, wrapped: string, extractable: boolean): Promise<CryptoKey | null> {
  const bytes = fromBase64url(wrapped)
  if (!bytes) return null
  try {
    return await subtle().unwrapKey('raw', bytes, kek, 'AES-KW', { name: 'AES-GCM', length: 256 }, extractable, [
      'encrypt',
      'decrypt',
    ])
  } catch {
    // AES-KW prüft die Integrität: ein falscher Schlüssel fällt hier auf, ein eigener Prüfwert ist nicht nötig
    return null
  }
}

/** Unbekanntes Verfahren oder zu wenige Iterationen (manipulierte oder fremde Datenbank) wird abgelehnt */
function checkedKdf(kdf: unknown): VaultKdf & { saltBytes: Bytes } {
  const parsed = kdfSchema.safeParse(kdf)
  const saltBytes = parsed.success ? fromBase64url(parsed.data.salt) : null
  if (!parsed.success || !saltBytes) throw new VaultError('unsupported_kdf')
  return { ...parsed.data, saltBytes }
}

async function passwordKek(password: string, kdf: VaultKdf): Promise<CryptoKey> {
  const { iterations, saltBytes } = checkedKdf(kdf)
  return importKek(await pbkdf2(password, saltBytes, iterations))
}

async function recoveryKek(recovery: Bytes, salt: Bytes): Promise<CryptoKey> {
  return importKek(await hkdf(recovery, salt, utf8(RECOVERY_INFO)))
}

/** Neue Ableitung immer mit den eigenen Standardwerten und neuem Salt */
async function newPasswordWrap(password: string, key: CryptoKey): Promise<{ kdf: VaultKdf; wrappedKey: string }> {
  const kdf: VaultKdf = { name: 'PBKDF2-SHA-256', iterations: KDF_MIN_ITERATIONS, salt: toBase64url(randomBytes(16)) }
  return { kdf, wrappedKey: toBase64url(await wrapKey(await passwordKek(password, kdf), key)) }
}

/** Wiederherstellungsschlüssel: 160 Bit Zufall, gezeigt als 32 Zeichen Crockford-Base32 in 8 Vierergruppen */
async function newRecoveryWrap(key: CryptoKey) {
  const recovery = randomBytes(RECOVERY_BYTES)
  const salt = randomBytes(16)
  const recoveryWrappedKey = toBase64url(await wrapKey(await recoveryKek(recovery, salt), key))
  return { recoveryKey: toCrockford(recovery), recoverySalt: toBase64url(salt), recoveryWrappedKey }
}

/** Liest einen Wiederherstellungsschlüssel – Groß/klein, Bindestriche, O/0 und I/L/1 sind egal */
export function parseRecoveryKey(text: string): Bytes | null {
  return fromCrockford(text, RECOVERY_BYTES)
}

/**
 * Neuer Tresor: zufälliger Schlüssel, verpackt mit Passwort und neuem Wiederherstellungsschlüssel. Zurück kommen das
 * Material für den Server, der Wiederherstellungsschlüssel zum Aufschreiben und der Schlüssel zum sofortigen Benutzen.
 */
export async function createVaultMaterial(
  password: string,
): Promise<{ material: VaultMaterial; recoveryKey: string; key: CryptoKey }> {
  const fresh = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  const byPassword = await newPasswordWrap(password, fresh)
  const { recoveryKey, ...byRecovery } = await newRecoveryWrap(fresh)
  // Zum Benutzen nicht exportierbar: einmal mit dem Passwort öffnen statt den exportierbaren Schlüssel zu behalten
  const key = await unwrap(await passwordKek(password, byPassword.kdf), byPassword.wrappedKey, false)
  if (!key) throw new VaultError('wrong_password')
  return { material: { ...byPassword, ...byRecovery }, recoveryKey, key }
}

export async function unlockWithPassword(info: VaultInfo, password: string, extractable = false): Promise<CryptoKey> {
  const key = await unwrap(await passwordKek(password, info.kdf), info.wrappedKey, extractable)
  if (!key) throw new VaultError('wrong_password')
  return key
}

export async function unlockWithRecoveryKey(
  info: VaultInfo,
  recoveryKey: string,
  extractable = false,
): Promise<CryptoKey> {
  const recovery = parseRecoveryKey(recoveryKey)
  const salt = fromBase64url(info.recoverySalt)
  if (!recovery || !salt) throw new VaultError('wrong_recovery_key')
  const key = await unwrap(await recoveryKek(recovery, salt), info.recoveryWrappedKey, extractable)
  if (!key) throw new VaultError('wrong_recovery_key')
  return key
}

const unlockExtractable = (info: VaultInfo, secret: VaultSecret) =>
  'password' in secret
    ? unlockWithPassword(info, secret.password, true)
    : unlockWithRecoveryKey(info, secret.recoveryKey, true)

/** Neues Passwort (mit dem alten oder dem Wiederherstellungsschlüssel): nur neu verpacken, nichts neu verschlüsseln */
export async function rewrapWithPassword(info: VaultInfo, secret: VaultSecret, newPassword: string) {
  return newPasswordWrap(newPassword, await unlockExtractable(info, secret))
}

/** Neuer Wiederherstellungsschlüssel (mit dem Passwort) – der alte gilt danach nicht mehr */
export async function renewRecoveryKey(info: VaultInfo, password: string) {
  return newRecoveryWrap(await unlockWithPassword(info, password, true))
}

/** Feld verschlüsseln: frischer IV je Aufruf, AAD aus ID und Feld */
export async function encryptField(key: CryptoKey, id: string, field: VaultField, plaintext: string): Promise<string> {
  const iv = randomBytes(12)
  const sealed = await seal(key, iv, aad(id, field), utf8(plaintext))
  return `nv1.${toBase64url(iv)}.${toBase64url(sealed)}`
}

/**
 * Feld entschlüsseln. Ein Fehler gilt nie als leerer Text (sonst überschriebe das Speichern die Notiz): Verändert,
 * vertauscht (andere Notiz, anderes Feld) oder kaputt → `VaultError('corrupt')`.
 */
export async function decryptField(key: CryptoKey, id: string, field: VaultField, envelope: string): Promise<string> {
  if (!VAULT_ENVELOPE_RE.test(envelope)) throw new VaultError('corrupt')
  const [, ivText, sealedText] = envelope.split('.')
  const iv = fromBase64url(ivText)
  const sealed = fromBase64url(sealedText)
  if (!iv || !sealed) throw new VaultError('corrupt')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(await open(key, iv, aad(id, field), sealed))
  } catch {
    throw new VaultError('corrupt')
  }
}
