import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ADMIN_PASSWORD, call, loginAs, setupTestEnv } from '@/tests/helpers'
import * as system from '@/app/api/admin/system/route'
import * as version from '@/app/api/version/route'
import * as requestRoute from '@/app/api/admin/system/update/route'
import { parseStatusFile, readUpdateStatus } from './server/update-status'

let env: Awaited<ReturnType<typeof setupTestEnv>>
let dir: string

beforeAll(async () => {
  env = await setupTestEnv()
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-update-status-'))
  process.env.UPDATE_STATUS_DIR = dir
})

afterAll(async () => {
  delete process.env.UPDATE_STATUS_DIR
  fs.rmSync(dir, { recursive: true, force: true })
  await env.cleanup()
})

beforeEach(() => {
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { recursive: true })
})

describe('Update-Status', () => {
  it('liest KEY=Wert-Zeilen und ignoriert alles andere', () => {
    expect(parseStatusFile('STATE=ok\nMESSAGE=Aktuell (v1.0.0) = gut\n# Kommentar\nkaputt\nlower=x\n')).toEqual({
      STATE: 'ok',
      MESSAGE: 'Aktuell (v1.0.0) = gut',
    })
  })

  it('meldet „nicht eingerichtet“ ohne Statusdatei', () => {
    expect(readUpdateStatus()).toEqual({ configured: false })
  })

  it('wertet die Statusdatei des Update-Skripts aus', () => {
    fs.writeFileSync(
      path.join(dir, 'status'),
      [
        'CHECKED_AT=1760000000',
        'STATE=rolled_back',
        'CURRENT=v1.0.0',
        'LATEST=v1.1.0',
        'UPDATED_AT=',
        'FAILED_TAG=v1.1.0',
        'FAILED_AT=1760000100',
        'FAILED_STAGE=deploy',
        'MESSAGE=Update auf v1.1.0 fehlgeschlagen – läuft wieder mit v1.0.0',
      ].join('\n') + '\n',
    )
    fs.writeFileSync(path.join(dir, 'last-run.log'), '\x1b[32m#5 DONE\x1b[0m\r\n[2026-10-13 04:00:00] FEHLER: v1.1.0 startet nicht\n')
    expect(readUpdateStatus()).toEqual({
      configured: true,
      state: 'rolled_back',
      checkedAt: 1760000000_000,
      current: 'v1.0.0',
      latest: 'v1.1.0',
      updatedAt: null,
      failedTag: 'v1.1.0',
      failedAt: 1760000100_000,
      failedStage: 'deploy',
      message: 'Update auf v1.1.0 fehlgeschlagen – läuft wieder mit v1.0.0',
      log: '#5 DONE\n[2026-10-13 04:00:00] FEHLER: v1.1.0 startet nicht',
    })
  })

  it('liefert von langen Protokollen nur das Ende und erkennt unbekannte Zustände', () => {
    fs.writeFileSync(path.join(dir, 'status'), 'STATE=komisch\nFAILED_STAGE=sonstwo\nCHECKED_AT=abc\n')
    const lines = Array.from({ length: 5000 }, (_, i) => `Zeile ${i} ${'x'.repeat(20)}`)
    fs.writeFileSync(path.join(dir, 'last-run.log'), lines.join('\n'))
    const status = readUpdateStatus()
    if (!status.configured) throw new Error('erwartet: eingerichtet')
    expect(status.state).toBe('unknown')
    expect(status.failedStage).toBeNull()
    expect(status.checkedAt).toBeNull()
    expect(status.log!.length).toBeLessThanOrEqual(48 * 1024)
    expect(status.log!.startsWith('Zeile ')).toBe(true)
    expect(status.log!.endsWith('Zeile 4999 ' + 'x'.repeat(20))).toBe(true)
  })

  it('zeigt Version und Update-Status nur Administratoren', async () => {
    expect((await call(system.GET, '/api/admin/system')).status).toBe(401)
    fs.writeFileSync(path.join(dir, 'status'), 'STATE=ok\nCURRENT=v1.0.0\nLATEST=v1.0.0\n')
    const admin = await loginAs('admin', ADMIN_PASSWORD)
    const res = await call(system.GET, '/api/admin/system', { cookie: admin })
    expect(res.status).toBe(200)
    expect(res.data.system).toMatchObject({ version: 'dev', node: process.version, update: { configured: true, state: 'ok', current: 'v1.0.0' } })
  })

  it('legt Update-Anfragen aus dem Admin-Bereich ab', async () => {
    const admin = await loginAs('admin', ADMIN_PASSWORD)
    // Ohne Anfrage-Ordner (Update-Dienst nicht eingerichtet) → verständlicher Fehler
    let res = await call(requestRoute.POST, '/api/admin/system/update', { cookie: admin, body: {} })
    expect(res.status).toBe(503)
    expect(res.data.error).toBe('update_unavailable')
    expect((await call(system.GET, '/api/admin/system', { cookie: admin })).data.system).toMatchObject({
      canRequestUpdate: false,
      updateRequest: null,
    })

    fs.mkdirSync(path.join(dir, 'requests'))
    expect((await call(requestRoute.POST, '/api/admin/system/update', { body: {} })).status).toBe(401)
    expect((await call(requestRoute.POST, '/api/admin/system/update', { cookie: admin, body: {}, csrf: false })).status).toBe(403)
    res = await call(requestRoute.POST, '/api/admin/system/update', { cookie: admin, body: { retry: true } })
    expect(res.status).toBe(200)
    expect(res.data.updateRequest).toMatchObject({ retry: true, by: 'admin' })
    const file = fs.readFileSync(path.join(dir, 'requests/update'), 'utf8')
    expect(file).toMatch(/^ACTION=retry\nBY=admin\nAT=\d+\n$/)
    expect(fs.readdirSync(path.join(dir, 'requests'))).toEqual(['update'])
    const sys = (await call(system.GET, '/api/admin/system', { cookie: admin })).data.system
    expect(sys).toMatchObject({ canRequestUpdate: true, updateRequest: { retry: true, by: 'admin' } })
  })

  it('liefert die Build-ID für die Update-Erkennung im Browser', async () => {
    expect((await call(version.GET, '/api/version')).status).toBe(401)
    const admin = await loginAs('admin', ADMIN_PASSWORD)
    const res = await call(version.GET, '/api/version', { cookie: admin })
    expect(res.status).toBe(200)
    expect(res.data).toEqual({ buildId: 'dev', version: 'dev' })
  })
})
