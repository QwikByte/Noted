import fs from 'node:fs'
import path from 'node:path'
import type { NextConfig } from 'next'

type BuildInfo = { version: string; commit: string; buildDate: string; buildId: string }

/** Schreibt scripts/build-info.mjs vor jedem Build; ohne die Datei (z. B. bei `next dev`) gelten Entwicklungswerte. */
function readBuildInfo(): BuildInfo {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), '.build-info.json'), 'utf8')) as BuildInfo
  } catch {
    return { version: 'dev', commit: '', buildDate: '', buildId: 'dev' }
  }
}

const build = readBuildInfo()

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  // HSTS: Browser sprechen die Domain künftig nur noch über HTTPS an (schützt vor SSL-Stripping beim ersten
  // Aufruf in einem fremden Netz). Über HTTP ignorieren Browser den Header, daher gefahrlos auch beim lokalen
  // Zugriff auf Port 3000. Ohne includeSubDomains – das ist sicher für Server mit weiteren Subdomains ohne
  // HTTPS; verschärfen lässt es sich bei Bedarf am Reverse Proxy (siehe README, Abschnitt HTTPS).
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
]

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  // pdf.js liest auf dem Server den Text aus PDFs (Volltextsuche in Dateien) – ungebündelt aus node_modules laden
  serverExternalPackages: ['pdfjs-dist'],
  // Versionswechsel erkennen: Next.js hängt die ID an seine Dateien an und lädt bei Abweichung komplett neu
  deploymentId: build.buildId === 'dev' ? undefined : build.buildId,
  // Werden beim Build fest eingesetzt (Server und Browser), siehe features/updates/build.ts
  env: {
    NOTED_VERSION: build.version,
    NOTED_COMMIT: build.commit,
    NOTED_BUILD_DATE: build.buildDate,
    NOTED_BUILD_ID: build.buildId,
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
      // Geteilte Notizen gehören nicht in Suchmaschinen (zusätzlich zu robots im Seitenkopf)
      { source: '/s/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
      { source: '/api/s/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
    ]
  },
}

export default nextConfig
