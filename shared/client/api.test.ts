import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/shared/client/api'

/** fetch-Attrappe, die nur festhält, womit sie aufgerufen wurde */
function fakeFetch() {
  const calls: RequestInit[] = []
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    calls.push(init)
    return new Response('{}', { headers: { 'content-type': 'application/json' } })
  })
  return calls
}

afterEach(() => vi.unstubAllGlobals())

describe('api', () => {
  it('schickt den CSRF-Header und JSON mit', async () => {
    const calls = fakeFetch()
    await api('/api/test', { method: 'PUT', body: { a: 1 } })
    const headers = calls[0].headers as Headers
    expect(headers.get('x-noted-request')).toBe('1')
    expect(headers.get('content-type')).toBe('application/json')
    expect(calls[0].body).toBe('{"a":1}')
  })

  it('lässt keepalive nur bei kleinen Anfragen zu – große würden Browser sonst ablehnen', async () => {
    const calls = fakeFetch()
    await api('/api/test', { method: 'PUT', body: { content: 'kurz' }, keepalive: true })
    await api('/api/test', { method: 'PUT', body: { content: 'x'.repeat(100 * 1024) }, keepalive: true })
    await api('/api/test', { method: 'PUT', body: { content: 'kurz' } })
    expect(calls.map((c) => c.keepalive)).toEqual([true, false, undefined])
  })
})
