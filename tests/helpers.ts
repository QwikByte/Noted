import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'

export const ADMIN_PASSWORD = 'Admin-Passwort-123'

/** Frische, isolierte Umgebung (eigenes Datenverzeichnis) für eine Testdatei. */
export async function setupTestEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-test-'))
  process.env.DATA_DIR = dir
  process.env.ADMIN_USERNAME = 'admin'
  process.env.ADMIN_PASSWORD = ADMIN_PASSWORD
  process.env.SECRET_KEY = 'test-secret'
  const { closeDb, getDb } = await import('@/shared/server/db')
  const { clearAllRateLimits } = await import('@/shared/server/rate-limit')
  const { bootstrapAdmin } = await import('@/features/auth/server/bootstrap')
  closeDb()
  clearAllRateLimits()
  bootstrapAdmin(getDb())
  return {
    dir,
    cleanup() {
      closeDb()
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (req: NextRequest, ctx: { params: Promise<any> }) => Promise<Response>

export type CallOptions = {
  method?: string
  body?: unknown
  form?: FormData
  cookie?: string | null
  params?: Record<string, string | string[]>
  headers?: Record<string, string>
  csrf?: boolean
  query?: Record<string, string>
}

export async function call(handler: Handler, url: string, opts: CallOptions = {}) {
  const method = opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET')
  const headers = new Headers({ host: 'localhost:3000', ...opts.headers })
  if (opts.csrf !== false && method !== 'GET') headers.set('x-noted-request', '1')
  if (opts.cookie) headers.set('cookie', `noted_session=${opts.cookie}`)
  let body: BodyInit | undefined
  if (opts.form) body = opts.form
  else if (opts.body !== undefined) {
    headers.set('content-type', 'application/json')
    body = JSON.stringify(opts.body)
  }
  const u = new URL(url, 'http://localhost:3000')
  for (const [k, v] of Object.entries(opts.query ?? {})) u.searchParams.set(k, v)
  const req = new NextRequest(u, { method, headers, body })
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) })
  const setCookie = res.headers.get('set-cookie')
  const token = setCookie ? /noted_session=([^;]*)/.exec(setCookie)?.[1] : undefined
  let data: unknown = null
  const type = res.headers.get('content-type') ?? ''
  if (type.includes('application/json')) data = await res.json()
  return { status: res.status, data: data as Record<string, any>, res, token } // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Meldet sich an und liefert das Session-Token. */
export async function loginAs(username: string, password: string): Promise<string> {
  const { POST } = await import('@/app/api/auth/login/route')
  const r = await call(POST, '/api/auth/login', { body: { username, password } })
  if (r.status !== 200 || !r.token) throw new Error(`Login fehlgeschlagen: ${r.status} ${JSON.stringify(r.data)}`)
  return r.token
}
