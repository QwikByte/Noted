import 'server-only'
import { Secret, TOTP } from 'otpauth'
import QRCode from 'qrcode'

const PERIOD = 30

function build(secretBase32: string, label = 'Noted', issuer = 'Noted') {
  return new TOTP({
    issuer,
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: PERIOD,
    secret: Secret.fromBase32(secretBase32),
  })
}

export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32
}

export function totpUri(secretBase32: string, username: string, issuer: string): string {
  return build(secretBase32, username, issuer).toString()
}

export async function totpQrDataUrl(uri: string): Promise<string> {
  return QRCode.toDataURL(uri, { margin: 1, width: 240, errorCorrectionLevel: 'M' })
}

/** Nur Ziffern, Leerzeichen werden toleriert. */
export function normalizeTotpCode(code: string): string {
  return code.replace(/\s+/g, '')
}

/**
 * Prüft einen TOTP-Code (±1 Zeitfenster). Liefert den verwendeten Zeitschritt
 * zurück, damit derselbe Code nicht erneut verwendet werden kann (Replay-Schutz).
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  lastUsedStep: number,
  timestamp = Date.now(),
): { ok: true; step: number } | { ok: false } {
  const token = normalizeTotpCode(code)
  if (!/^\d{6}$/.test(token)) return { ok: false }
  const totp = build(secretBase32)
  const delta = totp.validate({ token, timestamp, window: 1 })
  if (delta === null) return { ok: false }
  const step = Math.floor(timestamp / 1000 / PERIOD) + delta
  if (step <= lastUsedStep) return { ok: false }
  return { ok: true, step }
}

/** Nur für Tests. */
export function generateTotpCode(secretBase32: string, timestamp = Date.now()): string {
  return build(secretBase32).generate({ timestamp })
}
