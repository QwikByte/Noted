import 'server-only'
// Microsoft-Konto: Anmeldung (OAuth 2.0 mit PKCE) und Microsoft Graph. Nur lesender Zugriff auf Kalender.
import crypto from 'node:crypto'
import { getConfig } from '@/shared/server/config'
import { ApiError } from '@/shared/server/http'

export type MicrosoftConfig = {
  clientId: string
  clientSecret: string
  tenant: string
  loginUrl: string
  graphUrl: string
}

export type TokenSet = { accessToken: string; refreshToken: string; expiresAt: number; idToken: string | null }

/** Die Anmeldung gilt nicht mehr (widerrufen, abgelaufen, Passwort geändert) – neu verbinden */
export class MicrosoftAuthError extends Error {}

const TIMEOUT_MS = 15_000

/** Eingerichtet? Ohne Client-ID und Secret gibt es keinen Kalender */
export function microsoftConfig(): MicrosoftConfig | null {
  const { clientId, clientSecret, ...rest } = getConfig().microsoft
  return clientId && clientSecret ? { clientId, clientSecret, ...rest } : null
}

const scopes = (cfg: MicrosoftConfig) => ['openid', 'profile', 'email', 'offline_access', `${cfg.graphUrl}/Calendars.Read`].join(' ')

/** Zufälliger code_verifier und die passende code_challenge (S256) */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url')
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') }
}

export function authorizeUrl(cfg: MicrosoftConfig, opts: { redirectUri: string; state: string; challenge: string }): string {
  const url = new URL(`${cfg.loginUrl}/${encodeURIComponent(cfg.tenant)}/oauth2/v2.0/authorize`)
  url.search = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    redirect_uri: opts.redirectUri,
    response_mode: 'query',
    scope: scopes(cfg),
    state: opts.state,
    code_challenge: opts.challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString()
  return url.toString()
}

async function tokenRequest(cfg: MicrosoftConfig, params: Record<string, string>): Promise<TokenSet> {
  let res: Response
  try {
    res = await fetch(`${cfg.loginUrl}/${encodeURIComponent(cfg.tenant)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: scopes(cfg), ...params }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    console.error('[noted] Microsoft-Anmeldung nicht erreichbar', err)
    throw unreachable()
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok || typeof data.access_token !== 'string') {
    // invalid_grant: Code oder Refresh-Token ungültig – alles andere ist ein Fehler der Einrichtung
    if (data.error === 'invalid_grant') throw new MicrosoftAuthError(String(data.error_description ?? 'invalid_grant'))
    console.error('[noted] Microsoft-Anmeldung abgelehnt', res.status, data.error, data.error_description)
    throw new ApiError(502, 'calendar_setup', 'Microsoft hat die Anmeldung abgelehnt. Bitte den Admin, die Einrichtung zu prüfen.')
  }
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : (params.refresh_token ?? ''),
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    idToken: typeof data.id_token === 'string' ? data.id_token : null,
  }
}

export function exchangeCode(cfg: MicrosoftConfig, opts: { code: string; redirectUri: string; verifier: string }) {
  return tokenRequest(cfg, {
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: opts.redirectUri,
    code_verifier: opts.verifier,
  })
}

export function refreshTokens(cfg: MicrosoftConfig, refreshToken: string) {
  return tokenRequest(cfg, { grant_type: 'refresh_token', refresh_token: refreshToken })
}

/**
 * Name und E-Mail aus dem id_token. Die Signatur prüfen wir nicht: Das Token kommt direkt vom Token-Endpunkt
 * über TLS (so erlaubt es OpenID Connect) und dient nur der Anzeige.
 */
export function accountFromIdToken(idToken: string | null): { name: string; email: string } {
  try {
    const claims = JSON.parse(Buffer.from(idToken?.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>
    const text = (v: unknown) => (typeof v === 'string' ? v.slice(0, 300) : '')
    return { name: text(claims.name), email: text(claims.email) || text(claims.preferred_username) }
  } catch {
    return { name: '', email: '' }
  }
}

function unreachable() {
  return new ApiError(502, 'calendar_unavailable', 'Microsoft ist gerade nicht erreichbar. Versuch es später noch einmal.')
}

/** GET auf Microsoft Graph – `path` relativ zu /v1.0 oder eine vollständige nextLink-Adresse */
export async function graphGet<T>(cfg: MicrosoftConfig, accessToken: string, path: string): Promise<T> {
  const url = path.startsWith('https://') || path.startsWith('http://') ? path : `${cfg.graphUrl}/v1.0${path}`
  // Nur eigene Graph-Adressen abrufen, auch bei nextLink aus der Antwort
  if (!url.startsWith(`${cfg.graphUrl}/`)) throw unreachable()
  let res: Response
  try {
    res = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}`, prefer: 'outlook.timezone="UTC"' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    console.error('[noted] Microsoft Graph nicht erreichbar', err)
    throw unreachable()
  }
  if (res.status === 401) throw new MicrosoftAuthError('Graph: 401')
  if (res.status === 403 || res.status === 404) {
    throw new ApiError(502, 'calendar_forbidden', 'Microsoft gibt diesen Kalender nicht frei. Wähle in den Einstellungen einen anderen.')
  }
  if (!res.ok) {
    console.error('[noted] Microsoft Graph antwortet mit Fehler', res.status, await res.text().catch(() => ''))
    throw unreachable()
  }
  return (await res.json()) as T
}
