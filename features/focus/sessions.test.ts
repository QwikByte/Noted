import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueryClient } from '@tanstack/react-query'
import { ADMIN_PASSWORD, call, loginAs, setupTestEnv } from '@/tests/helpers'
import * as route from '@/app/api/focus/sessions/route'
import * as users from '@/app/api/admin/users/route'
import * as password from '@/app/api/account/password/route'
import { formatStudyTime, weeklyBySubject } from './sessions'
import type { FocusSession, FocusSessionData } from './types'

const MIN = 60_000
const at = (iso: string) => new Date(iso).getTime()
const session = (subject: string, startedAt: number, minutes: number, goal = ''): FocusSession => ({
  id: crypto.randomUUID(),
  subject,
  goal,
  startedAt,
  durationMs: minutes * MIN,
})

describe('Lernzeit pro Fach und Woche', () => {
  it('fasst Fächer ohne Rücksicht auf die Schreibweise zusammen und zählt je Woche (ab Montag)', () => {
    const weeks = ['2026-10-05', '2026-10-12']
    const rows = weeklyBySubject(
      [
        session('Analysis I', at('2026-10-05T10:00:00'), 25),
        session('analysis  i', at('2026-10-11T23:30:00'), 25),
        session('Analysis I', at('2026-10-12T00:10:00'), 50),
        session('', at('2026-10-13T09:00:00'), 15),
        session('Lineare Algebra', at('2026-10-14T09:00:00'), 25),
        session('Alt', at('2026-09-01T09:00:00'), 25),
      ],
      weeks,
    )
    expect(rows.map((r) => [r.subject, r.weeks.map((ms) => ms / MIN), r.total / MIN])).toEqual([
      ['Analysis I', [50, 50], 100],
      ['Lineare Algebra', [0, 25], 25],
      ['', [0, 15], 15],
    ])
  })

  it('schreibt Lernzeit lesbar', () => {
    expect([5, 59, 60, 125].map((m) => formatStudyTime(m * MIN))).toEqual(['5 min', '59 min', '1 h 00 min', '2 h 05 min'])
  })
})

describe('Gezählte Runden über die API', () => {
  let env: Awaited<ReturnType<typeof setupTestEnv>>
  let token = ''
  beforeAll(async () => {
    env = await setupTestEnv()
    token = await loginAs('admin', ADMIN_PASSWORD)
  })
  afterAll(() => env.cleanup())

  it('speichert jede Runde einmal, liefert Vorschläge und trennt die Konten', async () => {
    const a = session('  Analysis   I ', Date.now() - 2 * 86_400_000, 25, 'Kapitel 3')
    const b = session('Lineare Algebra', Date.now() - 86_400_000, 50)
    const save = (sessions: FocusSession[], cookie = token) => call(route.POST, '/', { cookie, body: { sessions } })
    expect((await save([a, b])).data).toEqual({ saved: 2 })
    expect((await save([a])).data).toEqual({ saved: 0 })
    expect((await save([{ ...a, id: 'keine-uuid' }])).status).toBe(400)
    expect((await save([{ ...a, id: crypto.randomUUID(), durationMs: 601 * MIN }])).status).toBe(400)

    const data = (await call(route.GET, '/', { cookie: token })).data as FocusSessionData
    expect(data.sessions.map((s) => [s.subject, s.goal, s.durationMs / MIN])).toEqual([
      ['Analysis I', 'Kapitel 3', 25],
      ['Lineare Algebra', '', 50],
    ])
    expect(data.subjects).toEqual(['Lineare Algebra', 'Analysis I'])

    await call(users.POST, '/api/admin/users', { cookie: token, body: { username: 'ben', password: 'Ben-Passwort-1234' } })
    const ben = await loginAs('ben', 'Ben-Passwort-1234')
    await call(password.POST, '/', { cookie: ben, body: { currentPassword: 'Ben-Passwort-1234', newPassword: 'Ben-Passwort-5678' } })
    expect((await call(route.GET, '/', { cookie: ben })).data).toEqual({ sessions: [], subjects: [] })
    // Eine fremde ID zählt nicht für ein anderes Konto
    expect((await save([a], ben)).data).toEqual({ saved: 0 })
  })
})

describe('Runden zählen im Browser', () => {
  const store = new Map<string, string>()
  const ok = () => new Response(JSON.stringify({ saved: 1 }), { status: 200, headers: { 'content-type': 'application/json' } })

  beforeEach(() => {
    store.clear()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
    vi.stubGlobal('window', { addEventListener: () => {} })
    vi.stubGlobal('document', { addEventListener: () => {} })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('hält abgelaufene Fokus-Runden offen, sendet nur bestätigte und keine Pausen', async () => {
    const { focusSessions, SUBJECT_KEY, GOAL_KEY } = await import('./client/sessions')
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue(ok())
    vi.stubGlobal('fetch', fetchMock)
    focusSessions.start(7, { invalidateQueries: () => Promise.resolve() } as unknown as QueryClient)
    store.set(SUBJECT_KEY, ' Analysis  I ')
    store.set(GOAL_KEY, 'Kapitel 3')
    const end = Date.now()
    focusSessions.recordEnded({ phase: 'focus', startedAt: end - 25 * MIN, endedAt: end, durationMs: 25 * MIN })
    // Dieselbe Runde aus einem zweiten Tab und eine Pause zählen nicht
    focusSessions.recordEnded({ phase: 'focus', startedAt: end - 25 * MIN, endedAt: end, durationMs: 25 * MIN })
    focusSessions.recordEnded({ phase: 'shortBreak', startedAt: end, endedAt: end + 5 * MIN, durationMs: 5 * MIN })
    const pending = focusSessions.getSnapshot().pending
    expect(pending.map((s) => [s.subject, s.goal, s.durationMs / MIN])).toEqual([['Analysis I', 'Kapitel 3', 25]])
    expect(focusSessions.pendingEndingAt(end)?.id).toBe(pending[0].id)

    // Bestätigt, aber offline: bleibt im Ausgang und geht beim nächsten Versuch raus
    focusSessions.confirm(pending[0].id)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(focusSessions.getSnapshot().outbox).toHaveLength(1))
    // Den gescheiterten Versuch erst ganz abschließen lassen – sonst läuft er noch und flush() kehrt sofort zurück
    await new Promise((resolve) => setTimeout(resolve))
    await focusSessions.flush()
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string).sessions[0]).toMatchObject({ subject: 'Analysis I', durationMs: 25 * MIN })
    expect(focusSessions.getSnapshot()).toEqual({ pending: [], outbox: [] })
    expect(store.has('noted:focus:sessions:7')).toBe(false)
  })
})
