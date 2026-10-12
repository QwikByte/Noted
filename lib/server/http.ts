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

/** Liest den Anfragekörper, bricht aber ab, sobald er größer als `limit` Bytes wird. */
export async function readBody(req: NextRequest, limit: number): Promise<Uint8Array> {
  const tooLarge = () =>
    new ApiError(413, 'too_large', `Die Anfrage ist zu groß (max. ${Math.max(1, Math.round(limit / 1024 / 1024))} MB).`)
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > limit) throw tooLarge()
  if (!req.body) return new Uint8Array(0)
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel().catch(() => {})
      throw tooLarge()
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}

/** multipart/form-data mit Größenbegrenzung lesen. */
export async function readForm(req: NextRequest, limit: number): Promise<FormData> {
  const bytes = await readBody(req, limit)
  try {
    return await new Response(bytes as BodyInit, {
      headers: { 'content-type': req.headers.get('content-type') ?? '' },
    }).formData()
  } catch {
    throw badRequest('Ungültiger Upload.')
  }
}

/** JSON-Körper lesen (Standard: max. 5 MB, Notizen dürfen bis zu 2 Mio. Zeichen haben) und prüfen. */
export async function parseJson<S extends z.ZodType>(
  req: NextRequest,
  schema: S,
  limit = 5 * 1024 * 1024,
): Promise<z.infer<S>> {
  let body: unknown
  const bytes = await readBody(req, limit)
  try {
    body = JSON.parse(new TextDecoder().decode(bytes))
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

      // Seite wurde für ein anderes Konto geladen (z. B. in einem anderen Tab umgemeldet)
      const claimed = req.headers.get('x-noted-user')
      if (claimed && claimed !== String(user.id)) {
        throw new ApiError(401, 'user_mismatch', 'Du bist inzwischen mit einem anderen Konto angemeldet.')
      }

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
