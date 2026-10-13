// scripts/auto-update.sh gegen ein echtes Git-Repository mit Release-Tags – Docker wird durch ein
// Skript ersetzt, das sich Images und den laufenden Container in Dateien merkt.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const SCRIPT = path.resolve(import.meta.dirname, '../scripts/auto-update.sh')

const FAKE_DOCKER = `#!/usr/bin/env bash
# Nachgebautes docker: Images = Dateien image-<tag>, laufender Container = Datei running
d=$FAKE_DIR
echo "docker $*" >> "$d/calls.log"
img() { echo "$d/image-\${1#noted:}"; }
if [[ $1 == compose ]]; then
  shift
  case $1 in
    version) exit 0 ;;
    build) [[ $APP_VERSION == "\${FAKE_BUILD_FAIL:-}" ]] && { echo "build kaputt"; exit 1; }
           echo "$APP_VERSION" > "$(img latest)"; exit 0 ;;
    up) cp "$(img latest)" "$d/running"; exit 0 ;;
    stop) rm -f "$d/running"; exit 0 ;;
    ps) [[ -f $d/running ]] && echo cid1; exit 0 ;;
    logs) echo "app log"; exit 0 ;;
    exec|run)
      if [[ "$*" == *"admin-cli.mjs backup"* ]]; then echo "/data/backups/noted-\${@: -1}.db"; exit 0; fi
      if [[ "$*" == *"admin-cli.mjs restore"* ]]; then echo "restore from $(cat "$(img latest)")" >> "$d/restores.log"; exit 0; fi
      # Gesundheitsprüfung
      [[ $(cat "$d/running" 2>/dev/null) == "\${FAKE_BAD:-none}" ]] && exit 1
      exit 0 ;;
  esac
  exit 0
fi
case $1 in
  inspect) echo true ;;
  image)
    case $2 in
      inspect) [[ -f $(img "$3") ]] ;;
      ls) for f in "$d"/image-*; do [[ -f $f ]] && echo "\${f##*/image-}"; done ;;
      *) exit 0 ;;
    esac ;;
  tag) cp "$(img "$2")" "$(img "$3")" ;;
  rmi) rm -f "$(img "$2")" ;;
esac
`

let base: string
let work: string
let server: string
let fake: string

function sh(cwd: string, ...args: string[]) {
  return execFileSync(args[0], args.slice(1), { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function release(tag: string, file = 'version.txt') {
  fs.writeFileSync(path.join(work, file), `${tag}\n`)
  sh(work, 'git', 'add', '-A')
  sh(work, 'git', 'commit', '-q', '-m', tag)
  sh(work, 'git', 'tag', tag)
  sh(work, 'git', 'push', '-q', 'origin', 'HEAD:main', '--tags')
}

function update(args: string[] = [], env: Record<string, string> = {}) {
  const res = spawnSync('bash', [path.join(server, 'scripts/auto-update.sh'), '-q', ...args], {
    cwd: server,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${path.join(fake, 'bin')}:${process.env.PATH}`,
      FAKE_DIR: fake,
      NOTED_HEALTH_INTERVAL: '0',
      NOTED_HEALTH_TIMEOUT: '1',
      ...env,
    },
  })
  return { code: res.status, stderr: res.stderr, stdout: res.stdout }
}

function status(): Record<string, string> {
  const text = fs.readFileSync(path.join(server, '.update/status'), 'utf8')
  return Object.fromEntries(text.trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
}

const calls = () => (fs.existsSync(path.join(fake, 'calls.log')) ? fs.readFileSync(path.join(fake, 'calls.log'), 'utf8') : '')
const running = () => fs.readFileSync(path.join(fake, 'running'), 'utf8').trim()
const resetCalls = () => fs.rmSync(path.join(fake, 'calls.log'), { force: true })
const serverVersion = () => fs.readFileSync(path.join(server, 'version.txt'), 'utf8').trim()

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-update-'))
  work = path.join(base, 'work')
  server = path.join(base, 'server')
  fake = path.join(base, 'fake')
  fs.mkdirSync(path.join(fake, 'bin'), { recursive: true })
  fs.writeFileSync(path.join(fake, 'bin/docker'), FAKE_DOCKER, { mode: 0o755 })

  sh(base, 'git', 'init', '-q', '--bare', 'origin.git')
  fs.mkdirSync(path.join(work, 'scripts'), { recursive: true })
  fs.mkdirSync(path.join(work, '.update'))
  fs.copyFileSync(SCRIPT, path.join(work, 'scripts/auto-update.sh'))
  fs.chmodSync(path.join(work, 'scripts/auto-update.sh'), 0o755)
  fs.writeFileSync(path.join(work, '.update/.gitkeep'), '')
  fs.writeFileSync(path.join(work, '.gitignore'), '/.update/*\n!/.update/.gitkeep\n')
  fs.writeFileSync(path.join(work, 'version.txt'), 'unreleased\n')
  sh(work, 'git', 'init', '-q', '-b', 'main')
  sh(work, 'git', 'config', 'user.email', 'test@example.com')
  sh(work, 'git', 'config', 'user.name', 'Test')
  sh(work, 'git', 'remote', 'add', 'origin', path.join(base, 'origin.git'))
  sh(work, 'git', 'add', '-A')
  sh(work, 'git', 'commit', '-q', '-m', 'start')
  sh(work, 'git', 'push', '-q', 'origin', 'HEAD:main')
  sh(base, 'git', 'clone', '-q', '-b', 'main', path.join(base, 'origin.git'), 'server')
})

afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true })
})

describe('auto-update.sh', () => {
  it('meldet, dass es noch kein Release gibt', () => {
    const res = update()
    expect(res.code).toBe(0)
    expect(status()).toMatchObject({ STATE: 'ok', LATEST: '', CURRENT: '' })
    expect(status().MESSAGE).toContain('Noch kein Release')
    expect(calls()).not.toContain('compose build')
  })

  it('installiert das erste Release', () => {
    release('v1.0.0')
    const res = update()
    expect(res.stderr).toBe('')
    expect(res.code).toBe(0)
    expect(status()).toMatchObject({ STATE: 'ok', CURRENT: 'v1.0.0', LATEST: 'v1.0.0', FAILED_TAG: '' })
    expect(running()).toBe('v1.0.0')
    expect(serverVersion()).toBe('v1.0.0')
    expect(calls()).toContain('admin-cli.mjs backup vor-v1.0.0')
    expect(fs.readFileSync(path.join(server, '.update/last-run.log'), 'utf8')).toContain('Fertig: v1.0.0 läuft.')
  })

  it('tut nichts, wenn alles aktuell ist', () => {
    resetCalls()
    expect(update().code).toBe(0)
    expect(status()).toMatchObject({ STATE: 'ok', MESSAGE: 'Aktuell (v1.0.0)' })
    expect(calls()).not.toContain('compose build')
  })

  it('ignoriert Vorabversionen', () => {
    release('v1.1.0-beta')
    resetCalls()
    expect(update().code).toBe(0)
    expect(status().LATEST).toBe('v1.0.0')
    expect(calls()).not.toContain('compose build')
  })

  it('rollt zurück, wenn die neue Version nicht startet, und überspringt sie danach', () => {
    release('v1.1.0')
    const res = update([], { FAKE_BAD: 'v1.1.0' })
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('v1.1.0 startet nicht')
    expect(status()).toMatchObject({ STATE: 'rolled_back', CURRENT: 'v1.0.0', FAILED_TAG: 'v1.1.0', FAILED_STAGE: 'deploy' })
    expect(running()).toBe('v1.0.0')
    expect(serverVersion()).toBe('v1.0.0')
    // Datenbank-Wiederherstellung mit dem alten Image, nur falls das Schema migriert wurde
    expect(calls()).toMatch(/admin-cli\.mjs restore \/data\/backups\/noted-vor-v1\.1\.0\.db --if-schema-changed/)
    expect(fs.readFileSync(path.join(fake, 'restores.log'), 'utf8')).toContain('restore from v1.0.0')

    resetCalls()
    expect(update().code).toBe(0)
    expect(calls()).not.toContain('compose build')
    expect(status().STATE).toBe('rolled_back')
  })

  it('meldet mit --check nur ein neues Release', () => {
    release('v1.2.0')
    resetCalls()
    expect(update(['--check']).code).toBe(0)
    expect(status()).toMatchObject({ LATEST: 'v1.2.0', CURRENT: 'v1.0.0', MESSAGE: 'Neues Release verfügbar: v1.2.0' })
    expect(calls()).not.toContain('compose build')
  })

  it('lässt bei einem Build-Fehler die alte Version weiterlaufen', () => {
    const res = update([], { FAKE_BUILD_FAIL: 'v1.2.0' })
    expect(res.code).toBe(1)
    expect(status()).toMatchObject({ STATE: 'failed', FAILED_TAG: 'v1.2.0', FAILED_STAGE: 'build', CURRENT: 'v1.0.0' })
    expect(running()).toBe('v1.0.0')
    expect(serverVersion()).toBe('v1.0.0')
    expect(fs.readFileSync(path.join(server, '.update/last-run.log'), 'utf8')).toContain('build kaputt')
  })

  it('versucht ein fehlgeschlagenes Release mit --retry erneut', () => {
    expect(update(['--retry']).code).toBe(0)
    expect(status()).toMatchObject({ STATE: 'ok', CURRENT: 'v1.2.0', FAILED_TAG: '', MESSAGE: 'Aktualisiert auf v1.2.0' })
    expect(running()).toBe('v1.2.0')
    expect(serverVersion()).toBe('v1.2.0')
  })

  it('bricht bei lokalen Änderungen im Repository ab', () => {
    release('v1.3.0')
    fs.writeFileSync(path.join(server, 'version.txt'), 'lokal geändert\n')
    resetCalls()
    const res = update()
    expect(res.code).toBe(1)
    expect(status()).toMatchObject({ STATE: 'failed', FAILED_TAG: 'v1.3.0', CURRENT: 'v1.2.0' })
    expect(status().MESSAGE).toContain('Lokale Änderungen')
    expect(calls()).not.toContain('compose build')
    sh(server, 'git', 'checkout', '--', 'version.txt')
  })

  it('räumt alte Images auf und behält die letzten drei Releases', () => {
    release('v1.4.0')
    release('v1.5.0')
    expect(update(['--retry']).code).toBe(0)
    expect(running()).toBe('v1.5.0')
    const images = fs
      .readdirSync(fake)
      .filter((f) => f.startsWith('image-v'))
      .map((f) => f.slice(6))
      .sort()
    // Gebaut wurden v1.0.0, v1.1.0 (zurückgerollt), v1.2.0 und v1.5.0 – das älteste fällt weg
    expect(images).toEqual(['v1.1.0', 'v1.2.0', 'v1.5.0'])
    expect(fs.readFileSync(path.join(fake, 'image-previous'), 'utf8').trim()).toBe('v1.2.0')
  })

  it('holt Anfragen aus dem Admin-Bereich ab (auch „erneut versuchen“)', () => {
    release('v1.6.0')
    // fehlgeschlagen → würde ohne Anfrage übersprungen
    expect(update([], { FAKE_BAD: 'v1.6.0' }).code).toBe(1)
    expect(status()).toMatchObject({ STATE: 'rolled_back', FAILED_TAG: 'v1.6.0' })
    resetCalls()
    expect(update().code).toBe(0)
    expect(calls()).not.toContain('compose build')

    const request = path.join(server, '.update/requests/update')
    fs.writeFileSync(request, 'ACTION=retry\nBY=ad;min$(x)\nAT=1760000000\n')
    expect(update().code).toBe(0)
    expect(fs.existsSync(request)).toBe(false)
    expect(status()).toMatchObject({ STATE: 'ok', CURRENT: 'v1.6.0', FAILED_TAG: '' })
    expect(fs.readFileSync(path.join(server, '.update/update.log'), 'utf8')).toContain('Im Admin-Bereich angestoßen von adminx (erneuter Versuch)')
  })

  it('zeigt den Status mit --status', () => {
    const res = update(['--status'])
    expect(res.stdout).toContain('CURRENT=v1.6.0')
  })
})
