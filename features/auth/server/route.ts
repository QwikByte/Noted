import 'server-only'
import type { NextRequest } from 'next/server'
import { ApiError, checkCsrf, clientIp, errorResponse, forbidden } from '@/shared/server/http'
import { getSession, SESSION_COOKIE, type SessionRow } from './session'
import { pendingSetup, type UserRow } from './users'

/**
 * Wrapper für alle API-Routen: CSRF-Prüfung, Anmeldung und Rolle prüfen, Fehler einheitlich als JSON beantworten.
 *   none  – ohne Anmeldung (z. B. Login)
 *   mfa   – Passwort ist geprüft, MFA-Code steht noch aus
 *   setup – angemeldet, Kontoeinrichtung (Passwort/MFA) darf noch offen sein
 *   user  – angemeldet und eingerichtet
 *   admin – wie user, zusätzlich Rolle admin
 */
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
  // Implementierung der beiden Überladungen oben – die Typprüfung für Aufrufer übernehmen diese
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
