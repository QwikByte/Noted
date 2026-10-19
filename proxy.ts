import { NextResponse, type NextRequest } from 'next/server'
import { getConfig } from '@/shared/server/config'

const PUBLIC_PATHS = ['/login']

/**
 * - Content-Security-Policy mit Nonce für jede Seite
 * - Schnelle Umleitung zur Anmeldung, wenn gar kein Session-Cookie existiert
 *   (die eigentliche Prüfung passiert serverseitig in Layouts und API-Routen)
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))

  if (!isPublic && !request.cookies.has('noted_session')) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = pathname === '/' && !search ? '' : `?next=${encodeURIComponent(pathname + search)}`
    return NextResponse.redirect(url)
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const isDev = process.env.NODE_ENV === 'development'
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    // Externe Bilder (![](https://…)) lassen sich per EXTERNAL_IMAGES=false abschalten
    `img-src 'self' data: blob:${getConfig().externalImages ? ' https:' : ''}`,
    "media-src 'self' blob:",
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', csp)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', csp)
  return response
}

export const config = {
  matcher: [
    {
      source: '/((?!api|_next/static|_next/image|icons|pdfjs|sw.js|manifest.webmanifest|icon.svg|apple-icon.png|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
}
