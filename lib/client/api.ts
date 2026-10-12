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

export async function api<T = unknown>(url: string, opts: Options = {}): Promise<T> {
  const headers = new Headers(opts.headers)
  headers.set('x-noted-request', '1')
  let body: BodyInit | undefined
  if (opts.form) body = opts.form
  else if (opts.body !== undefined) {
    headers.set('content-type', 'application/json')
    body = JSON.stringify(opts.body)
  }
  let res: Response
  try {
    res = await fetch(url, { ...opts, headers, body, credentials: 'same-origin' })
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

/** Abgelaufene Sitzung → Login; ausstehende Kontoeinrichtung → Setup-Seite */
function handleAuthError(err: ApiError) {
  if (typeof window === 'undefined') return
  if (err.status === 401 && !location.pathname.startsWith('/login')) {
    location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`
  } else if (err.code === 'setup_required' && !location.pathname.startsWith('/setup')) {
    location.href = '/setup'
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError || err instanceof NetworkError) return err.message
  if (err instanceof Error) return err.message
  return 'Unbekannter Fehler.'
}
