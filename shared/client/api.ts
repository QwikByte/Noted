'use client'
// Fetch-Wrapper für die eigene API: CSRF-Header, JSON, einheitliche Fehler.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public body: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

/** Netzwerkfehler (offline, Server nicht erreichbar) */
export class NetworkError extends Error {
  constructor() {
    super('Keine Verbindung zum Server.')
  }
}

type Options = Omit<RequestInit, 'body'> & { body?: unknown; form?: FormData }

/** Browser lehnen `keepalive`-Anfragen mit mehr als 64 KB Körper ab – etwas Spielraum für Header lassen */
const KEEPALIVE_MAX_BYTES = 60 * 1024

let currentUserId: number | null = null

/**
 * Konto, für das diese Seite geladen wurde. Wird bei jeder Anfrage mitgeschickt – meldet sich in einem
 * anderen Tab jemand anderes an, lehnt der Server ab, statt z. B. Entwürfe ins falsche Konto zu speichern.
 */
export function setApiUser(id: number) {
  currentUserId = id
}

export async function api<T = unknown>(url: string, opts: Options = {}): Promise<T> {
  const headers = new Headers(opts.headers)
  headers.set('x-noted-request', '1')
  if (currentUserId !== null) headers.set('x-noted-user', String(currentUserId))
  let body: BodyInit | undefined
  if (opts.form) body = opts.form
  else if (opts.body !== undefined) {
    headers.set('content-type', 'application/json')
    body = JSON.stringify(opts.body)
  }
  // Zu große Anfragen ohne keepalive schicken: Sie würden sonst sofort scheitern statt im Hintergrund weiterzulaufen
  const tooBigForKeepalive = typeof body === 'string' && new Blob([body]).size > KEEPALIVE_MAX_BYTES
  const keepalive = opts.keepalive && tooBigForKeepalive ? false : opts.keepalive
  let res: Response
  try {
    res = await fetch(url, { ...opts, headers, body, credentials: 'same-origin', keepalive })
  } catch {
    throw new NetworkError()
  }
  // Antwort aus dem Offline-Cache des Service Workers
  if (res.status === 503 && res.headers.get('x-noted-offline') === '1') throw new NetworkError()

  const type = res.headers.get('content-type') ?? ''
  const data = type.includes('application/json') ? await res.json().catch(() => null) : null
  if (!res.ok) {
    const err = new ApiError(
      res.status,
      (data?.error as string) ?? 'error',
      (data?.message as string) ?? `Fehler ${res.status}`,
      data ?? {},
    )
    handleAuthError(err)
    throw err
  }
  return data as T
}

let redirecting = false

/** Abgelaufene Sitzung → Offline-Daten löschen und zum Login; ausstehende Kontoeinrichtung → Setup-Seite */
function handleAuthError(err: ApiError) {
  if (typeof window === 'undefined' || redirecting) return
  if (err.status === 401 && !location.pathname.startsWith('/login')) {
    redirecting = true
    const target = `/login?next=${encodeURIComponent(location.pathname + location.search)}`
    void clearCachedData().finally(() => (location.href = target))
  } else if (err.code === 'setup_required' && !location.pathname.startsWith('/setup')) {
    location.href = '/setup'
  }
}

/** Vom Service Worker zwischengespeicherte Notizen und App-Seite löschen (beim Ab- und Anmelden, damit keine fremden Daten übrig bleiben). */
export async function clearCachedData() {
  try {
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k.startsWith('noted-data') || k.startsWith('noted-shell')).map((k) => caches.delete(k)))
    }
  } catch {
    /* egal */
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError || err instanceof NetworkError) return err.message
  if (err instanceof Error) return err.message
  return 'Unbekannter Fehler.'
}
