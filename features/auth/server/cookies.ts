import 'server-only'
import type { NextRequest, NextResponse } from 'next/server'
import { isSecureRequest } from '@/shared/server/http'
import { SESSION_COOKIE, sessionTtlMs, type SessionStage } from './session'

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
