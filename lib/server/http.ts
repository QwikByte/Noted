import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import type { z } from 'zod'
import { getConfig } from './config'
import { getSession, SESSION_COOKIE, sessionTtlMs, type SessionRow, type SessionStage } from './session'
import { pendingSetup, type UserRow } from './users'

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message)
  }
}

export const badRequest = (message: string, code = 'invalid_input') => new ApiError(400, code, message)
export const notFound = (message = 'Nicht gefunden.') => new ApiError(404, 'not_found', message)
export const forbidden = (message = 'Keine Berechtigung.') => new ApiError(403, 'forbidden', message)
export const conflict = (message: string, code = 'conflict', extra?: Record<string, unknown>) =>
  new ApiError(409, code, message, extra)

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init)
}

export function errorResponse(err: ApiError) {
  return NextResponse.json({ error: err.code, message: err.message, ...err.extra }, { status: err.status })
}

/** Client-IP. Hinter einem Reverse Proxy ist der letzte Eintrag in X-Forwarded-For die echte Adresse. */
export function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const parts = xff.split(',').map((p) => p.trim()).filter(Boolean)
    const ip = parts[parts.length - 1]
    if (ip) return ip.replace(/^::ffff:/, '').slice(0, 64)
  }
  return req.headers.get('x-real-ip')?.slice(0, 64) ?? null
}

export function isSecureRequest(req: NextRequest): boolean {
  const configured = getConfig().cookieSecure
  if (configured !== undefined) return configured
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  return proto === 'https' || req.nextUrl.protocol === 'https:'
}

export function setSessionCookie(res: NextResponse, req: NextRequest, token: string, stage: SessionStage) {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(req),
    path: '/',
    maxAge: Math.floor(sessionTtlMs(stage) / 1000),
  })
}

export function clearSessionCookie(res: NextResponse, req: NextRequest) {
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(req),
    path: '/',
    maxAge: 0,
  })
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * CSRF-Schutz für schreibende Anfragen:
 *  - eigener Header (erzwingt bei Cross-Origin einen CORS-Preflight, den wir nie erlauben)
 *  - Origin/Sec-Fetch-Site müssen zur eigenen Seite passen
 * Zusätzlich ist das Session-Cookie SameSite=Lax.
 */
export function checkCsrf(req: NextRequest): boolean {
  if (!MUTATING.has(req.method)) return true
  if (req.headers.get('x-noted-request') !== '1') return false
  if (req.headers.get('sec-fetch-site') === 'cross-site') return false
  const origin = req.headers.get('origin')
  if (origin) {
    let originHost: string
    try {
      originHost = new URL(origin).host
    } catch {
      return false
    }
    const { appUrl } = getConfig()
    if (appUrl) {
      try {
        if (new URL(appUrl).host === originHost) return true
      } catch {
        /* ungültige APP_URL – auf Host-Vergleich zurückfallen */
      }
    }
    const host = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || req.headers.get('host')
    if (!host || host !== originHost) return false
  }
  return true
}

export async function parseJson<S extends z.ZodType>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw badRequest('Ungültige Anfrage (kein JSON).')
  }
  const result = schema.safeParse(body)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw badRequest(issue?.message || 'Ungültige Eingabe.')
  }
  return result.data
}

export type AuthLevel = 'none' | 'mfa' | 'setup' | 'user' | 'admin'

export type HandlerContext<P> = {
  req: NextRequest
  params: P
  user: UserRow
  session: SessionRow
  ip: string | null
}

type RouteParams = Record<string, string | string[]>

export function route<P extends RouteParams = RouteParams>(
  level: Exclude<AuthLevel, 'none'>,
  handler: (ctx: HandlerContext<P>) => Promise<Response> | Response,
): (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response>
export function route<P extends RouteParams = RouteParams>(
  level: 'none',
  handler: (ctx: Omit<HandlerContext<P>, 'user' | 'session'>) => Promise<Response> | Response,
): (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response>
export function route<P extends RouteParams>(
  level: AuthLevel,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (ctx: any) => Promise<Response> | Response,
) {
  return async (req: NextRequest, ctx: { params: Promise<P> }) => {
    try {
      if (!checkCsrf(req)) throw new ApiError(403, 'csrf', 'Ungültige Anfrage (CSRF-Prüfung fehlgeschlagen).')
      const params = ctx?.params ? await ctx.params : ({} as P)
      const ip = clientIp(req)
      if (level === 'none') return await handler({ req, params, ip })

      const found = getSession(req.cookies.get(SESSION_COOKIE)?.value)
      if (!found) throw new ApiError(401, 'unauthorized', 'Bitte melde dich an.')
      const { session, user } = found

      if (level === 'mfa') {
        if (session.stage !== 'mfa') throw new ApiError(400, 'no_mfa_pending', 'Keine MFA-Anmeldung ausstehend.')
      } else {
        if (session.stage !== 'full') throw new ApiError(401, 'unauthorized', 'Bitte melde dich an.')
        if (level === 'user' || level === 'admin') {
          const pending = pendingSetup(user)
          if (pending) {
            throw new ApiError(403, 'setup_required', 'Bitte schließe zuerst die Kontoeinrichtung ab.', {
              setup: pending,
            })
          }
        }
        if (level === 'admin' && user.role !== 'admin') throw forbidden()
      }
      return await handler({ req, params, user, session, ip })
    } catch (err) {
      if (err instanceof ApiError) return errorResponse(err)
      console.error('[noted] Unerwarteter Fehler', req.method, req.nextUrl.pathname, err)
      return errorResponse(new ApiError(500, 'internal', 'Interner Serverfehler.'))
    }
  }
}
