// scripts/build-info.mjs in einem nachgebauten Projektordner: erzeugt public/sw.js mit Build-ID und pdf.js-Version
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-build-info-'))
afterAll(() => fs.rmSync(work, { recursive: true, force: true }))

function project(template: string, pdfjsVersion = '6.4.299') {
  const dir = fs.mkdtempSync(path.join(work, 'p-'))
  for (const sub of ['scripts', 'sw', 'public', 'node_modules/pdfjs-dist']) fs.mkdirSync(path.join(dir, sub), { recursive: true })
  fs.copyFileSync(path.join(root, 'scripts/build-info.mjs'), path.join(dir, 'scripts/build-info.mjs'))
  fs.writeFileSync(path.join(dir, 'sw/service-worker.js'), template)
  fs.writeFileSync(path.join(dir, 'node_modules/pdfjs-dist/package.json'), JSON.stringify({ version: pdfjsVersion }))
  const res = spawnSync('node', [path.join(dir, 'scripts/build-info.mjs')], { env: { ...process.env, APP_VERSION: 'v1.2.3' } })
  return { dir, status: res.status, stderr: res.stderr.toString() }
}

describe('Build-Infos und Service Worker', () => {
  it('setzt Build-ID und pdf.js-Version in den Service Worker ein', () => {
    const template = fs.readFileSync(path.join(root, 'sw/service-worker.js'), 'utf8')
    const { dir, status } = project(template)
    expect(status).toBe(0)
    const info = JSON.parse(fs.readFileSync(path.join(dir, '.build-info.json'), 'utf8'))
    expect(info).toMatchObject({ version: 'v1.2.3', buildId: expect.stringMatching(/^v1_2_3-[0-9a-f]{10}$/) })
    const sw = fs.readFileSync(path.join(dir, 'public/sw.js'), 'utf8')
    expect(sw).toContain(`const VERSION = ${JSON.stringify(info.buildId)}`)
    expect(sw).toContain(`const PDFJS_VERSION = "6.4.299"`)
    expect(sw).not.toContain('__NOTED_')
  })

  it('bricht ab, wenn ein Platzhalter fehlt', () => {
    const { status, stderr } = project("const VERSION = '__NOTED_BUILD_ID__'\n")
    expect(status).not.toBe(0)
    expect(stderr).toContain('__NOTED_PDFJS_VERSION__')
  })
})
