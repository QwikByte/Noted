import { NextResponse } from 'next/server'
import { isSecureRequest } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { OAUTH_COOKIE, OAUTH_TTL_MS, redirectUri, startConnect } from '@/features/calendar/server/calendar'

/** Startet „Mit Microsoft verbinden“: liefert die Adresse der Microsoft-Anmeldung, der Browser leitet dorthin weiter */
export const POST = route('user', ({ req, user }) => {
  const { url, cookie } = startConnect(user.id, redirectUri(req))
  const res = NextResponse.json({ url })
  res.cookies.set(OAUTH_COOKIE, cookie, {
    httpOnly: true,
    // Lax: Das Cookie muss bei der Rückleitung von Microsoft (Navigation von außen) mitkommen
    sameSite: 'lax',
    secure: isSecureRequest(req),
    path: '/api/calendar/callback',
    maxAge: OAUTH_TTL_MS / 1000,
  })
  return res
})
