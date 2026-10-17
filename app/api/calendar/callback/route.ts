import { NextResponse } from 'next/server'
import { isSecureRequest } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { OAUTH_COOKIE, finishConnect, redirectUri } from '@/features/calendar/server/calendar'

/** Rückkehr von der Microsoft-Anmeldung – danach zurück in die Einstellungen */
export const GET = route('user', async ({ req, user, ip }) => {
  const params = req.nextUrl.searchParams
  const redirect = redirectUri(req)
  const result = await finishConnect(user, {
    code: params.get('code'),
    state: params.get('state'),
    error: params.get('error'),
    cookie: req.cookies.get(OAUTH_COOKIE)?.value,
    redirect,
    ip,
  })
  const res = NextResponse.redirect(new URL(`/settings?kalender=${result}#kalender`, redirect), 303)
  res.cookies.set(OAUTH_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(req),
    path: '/api/calendar/callback',
    maxAge: 0,
  })
  return res
})
