/* Noted – Service Worker
 *
 * - App-Gerüst (Startseite) und statische Dateien werden gecacht, damit die App auch ohne Netz startet.
 * - Notiz-Daten (GET-Anfragen der API) werden „network first“ geladen und als Fallback für offline gespeichert.
 * - Schreibende Anfragen gehen immer direkt ans Netz; offline übernimmt die lokale Sicherung im Browser.
 * - Updates: scripts/build-info.mjs setzt beim Build die Build-ID ein, dadurch erkennt der Browser jede neue
 *   Version. Ein neuer Service Worker wartet, bis die App „Neu laden“ auslöst (Nachricht „skip-waiting“).
 *
 * Quelle: sw/service-worker.js – public/sw.js wird daraus erzeugt.
 */
const VERSION = '__NOTED_BUILD_ID__'
const SHELL_CACHE = 'noted-shell'
const STATIC_CACHE = 'noted-static'
const DATA_CACHE = 'noted-data'

const DATA_ROUTES = [
  /^\/api\/notes$/,
  /^\/api\/notes\/[0-9a-f-]{36}$/,
  /^\/api\/folders$/,
  /^\/api\/tags$/,
  /^\/api\/attachments$/,
  /^\/api\/flashcards$/,
  /^\/api\/calendar$/,
  /^\/api\/glossary$/,
  /^\/api\/graph$/,
  /^\/api\/stats$/,
]
const FILE_ROUTES = [/^\/api\/files\//, /^\/api\/attachments\/[0-9a-f-]{36}$/]

self.addEventListener('install', () => {
  // Erste Installation sofort aktivieren (Offline-Betrieb ab dem ersten Besuch).
  // Updates warten dagegen, damit offene Seiten nicht unter laufendem Betrieb ihre Dateien verlieren.
  if (!self.registration.active) self.skipWaiting()
})

/** Dateien früherer Versionen entfernen: Next.js hängt die Build-ID als ?dpl=… an seine Dateien an. */
async function pruneStatic() {
  const cache = await caches.open(STATIC_CACHE)
  for (const request of await cache.keys()) {
    const url = new URL(request.url)
    const dpl = url.searchParams.get('dpl')
    // Icons, Manifest und pdf.js werden bei Bedarf neu geladen, damit auch sie aktuell bleiben
    if ((dpl && dpl !== VERSION) || !url.pathname.startsWith('/_next/')) await cache.delete(request)
  }
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      // Caches älterer Service Worker (Name mit Versionsnummer)
      await Promise.all(keys.filter((k) => /^noted-(shell|static)-/.test(k)).map((k) => caches.delete(k)))
      await pruneStatic()
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type
  if (type === 'clear') {
    event.waitUntil(Promise.all([caches.delete(DATA_CACHE), caches.delete(SHELL_CACHE)]))
  } else if (type === 'skip-waiting') {
    self.skipWaiting()
  }
})

// Benachrichtigung des Fokus-Timers (auf Android nur über den Service Worker möglich): Antippen holt Noted nach vorn
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin)
      return open ? open.focus() : self.clients.openWindow('/')
    }),
  )
})

function offlineJson() {
  return new Response(JSON.stringify({ error: 'offline', message: 'Keine Verbindung zum Server.' }), {
    status: 503,
    headers: { 'content-type': 'application/json', 'x-noted-offline': '1' },
  })
}

async function purgeUserData() {
  await Promise.all([caches.delete(DATA_CACHE), caches.delete(SHELL_CACHE)])
}

async function networkFirst(request, cacheName, cacheKey) {
  const cache = await caches.open(cacheName)
  try {
    const response = await fetch(request)
    // Sitzung abgelaufen oder widerrufen: nichts mehr offline vorhalten
    if (response.status === 401) {
      await purgeUserData()
      return response
    }
    if (response.ok && response.status === 200 && !response.redirected) {
      cache.put(cacheKey || request, response.clone())
    }
    return response
  } catch (err) {
    const cached = await cache.match(cacheKey || request)
    if (cached) return cached
    throw err
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) cache.put(request, response.clone())
  return response
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Gehashte Next.js-Dateien ändern sich nie
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request))
    return
  }

  // Notiz-Daten: aktuell vom Server, offline aus dem Cache
  if (DATA_ROUTES.some((r) => r.test(url.pathname))) {
    event.respondWith(networkFirst(request, DATA_CACHE).catch(offlineJson))
    return
  }

  // Anhänge (Bilder usw.) – keine Teilbereiche (Range) cachen
  if (FILE_ROUTES.some((r) => r.test(url.pathname)) && !request.headers.has('range')) {
    event.respondWith(networkFirst(request, DATA_CACHE).catch(() => new Response('', { status: 503 })))
    return
  }

  if (url.pathname.startsWith('/api/')) return

  // Startseite (die eigentliche App) – auch mit Parametern wie /?n=…
  if (request.mode === 'navigate' && url.pathname === '/') {
    event.respondWith(
      networkFirst(request, SHELL_CACHE, '/').catch(
        () =>
          new Response(
            '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Offline</title><body style="font-family:system-ui;padding:2rem;text-align:center"><h1>Offline</h1><p>Noted ist ohne Verbindung noch nicht verfügbar. Öffne die App einmal mit Internet, dann funktioniert sie auch offline.</p></body>',
            { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } },
          ),
      ),
    )
    return
  }

  // Icons, Manifest und die Dateien des PDF-Viewers (pdf.js)
  if (url.pathname.startsWith('/icons/') || url.pathname.startsWith('/pdfjs/') || url.pathname === '/manifest.webmanifest' || url.pathname === '/icon.svg') {
    event.respondWith(cacheFirst(request))
  }
})
