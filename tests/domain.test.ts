// scripts/domain.sh (sudo noted-domain) mit nachgebauten Werkzeugen: Caddy, systemd, Docker, DNS und curl
// werden durch Skripte ersetzt, die ihre Aufrufe protokollieren und sich per Umgebungsvariable steuern lassen.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT = path.resolve(import.meta.dirname, '../scripts/domain.sh')

const STUBS: Record<string, string> = {
  id: `[[ $1 == -u ]] && echo 0 || /usr/bin/id "$@"`,
  caddy: `echo "caddy $*" >> "$FAKE_DIR/calls.log"
[[ $1 == validate ]] && grep -q UNGUELTIG "$3" && exit 1
exit 0`,
  systemctl: `echo "systemctl $*" >> "$FAKE_DIR/calls.log"; exit 0`,
  docker: `echo "docker $*" >> "$FAKE_DIR/calls.log"; exit 0`,
  curl: `echo "curl $*" >> "$FAKE_DIR/calls.log"
case "$*" in
  *--resolve*) [[ \${FAKE_HTTPS_FAIL:-} == 1 ]] && exit 7; exit 0 ;;
  *ipify*) echo "\${FAKE_PUBLIC_IP:-}"; exit 0 ;;
  *) exit 0 ;;
esac`,
  getent: `[[ -z \${FAKE_DNS:-} ]] && exit 2
for ip in $FAKE_DNS; do echo "$ip STREAM $2"; done`,
  ip: `echo "2: eth0    inet \${FAKE_IF_IP:-10.0.0.5}/24 brd 10.0.0.255 scope global eth0"`,
}

let base: string
let root: string
let caddyfile: string
let fake: string

function run(args: string[], env: Record<string, string> = {}) {
  const res = spawnSync('bash', [path.join(root, 'scripts/domain.sh'), ...args], {
    encoding: 'utf8',
    input: '',
    env: {
      ...process.env,
      PATH: `${path.join(fake, 'bin')}:${process.env.PATH}`,
      FAKE_DIR: fake,
      NOTED_CADDYFILE: caddyfile,
      NOTED_HTTPS_WAIT: '1',
      NOTED_WAIT_INTERVAL: '0',
      FAKE_DNS: '10.0.0.5',
      ...env,
    },
  })
  return { code: res.status, out: res.stdout + res.stderr }
}

const read = (f: string) => fs.readFileSync(f, 'utf8')
const calls = () => (fs.existsSync(path.join(fake, 'calls.log')) ? read(path.join(fake, 'calls.log')) : '')

// So schreiben die Installer bis v1.0.3 das Caddyfile (Neuinstallation mit E-Mail)
const LEGACY = `{
\temail alt@example.com
}

# Noted (eingerichtet von install.sh)
qwikbyte.de {
\treverse_proxy 127.0.0.1:3000
}
`

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-domain-'))
  root = path.join(base, 'noted')
  fake = path.join(base, 'fake')
  caddyfile = path.join(base, 'caddy/Caddyfile')
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
  fs.mkdirSync(path.join(fake, 'bin'), { recursive: true })
  fs.mkdirSync(path.dirname(caddyfile), { recursive: true })
  fs.copyFileSync(SCRIPT, path.join(root, 'scripts/domain.sh'))
  for (const [name, body] of Object.entries(STUBS)) {
    fs.writeFileSync(path.join(fake, 'bin', name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 })
  }
})

afterAll(() => fs.rmSync(base, { recursive: true, force: true }))

beforeEach(() => {
  fs.writeFileSync(caddyfile, LEGACY)
  fs.writeFileSync(path.join(root, '.env'), 'ADMIN_USERNAME=admin\nAPP_URL=https://qwikbyte.de\n')
  for (const f of fs.readdirSync(path.dirname(caddyfile))) {
    if (f !== 'Caddyfile') fs.rmSync(path.join(path.dirname(caddyfile), f))
  }
  fs.rmSync(path.join(fake, 'calls.log'), { force: true })
})

describe('noted-domain', () => {
  it('zeigt ohne Argument die aktuelle Domain', () => {
    const res = run([])
    expect(res.code).toBe(0)
    expect(res.out).toContain('Aktuelle Domain: qwikbyte.de')
    expect(calls()).toBe('')
  })

  it('stellt eine Installation im bisherigen Format auf die neue Domain um', () => {
    const res = run(['https://Notizen.Example.com/', '--yes'])
    expect(res.out).toContain('Fertig: Noted läuft unter https://notizen.example.com')
    expect(res.code).toBe(0)
    const cf = read(caddyfile)
    // alte Domain abgeschaltet, neue verwaltet eingetragen, globale Optionen unverändert
    expect(cf).not.toMatch(/^qwikbyte\.de \{/m)
    expect(cf).not.toContain('# Noted (eingerichtet von install.sh)')
    expect(cf).toContain('{\n\temail alt@example.com\n}')
    expect(cf).toContain('# >>> Noted – verwaltet von noted-domain, nicht von Hand ändern\nnotizen.example.com {\n\treverse_proxy 127.0.0.1:3000\n}\n# <<< Noted\n')
    expect(read(path.join(root, '.env'))).toContain('APP_URL=https://notizen.example.com')
    expect(read(path.join(root, '.env'))).not.toContain('qwikbyte.de')
    expect(calls()).toMatch(/caddy validate .* --adapter caddyfile/)
    expect(calls()).toContain('systemctl reload-or-restart caddy')
    expect(calls()).toContain('--resolve notizen.example.com:443:127.0.0.1')
    expect(calls()).toContain('docker compose up -d --no-build --force-recreate noted')
    // Sicherung der vorherigen Konfiguration
    const backups = fs.readdirSync(path.dirname(caddyfile)).filter((f) => f.startsWith('Caddyfile.vor-'))
    expect(backups).toHaveLength(1)
    expect(read(path.join(path.dirname(caddyfile), backups[0]))).toBe(LEGACY)

    // erneut: bereits eingestellt → nichts zu tun; ein weiterer Wechsel ersetzt nur den verwalteten Eintrag
    expect(run(['notizen.example.com', '--yes']).out).toContain('nichts zu tun')
    expect(run(['neu.example.org', '--yes']).code).toBe(0)
    const cf2 = read(caddyfile)
    expect(cf2.match(/# >>> Noted/g)).toHaveLength(1)
    expect(cf2).toContain('neu.example.org {')
    expect(cf2).not.toContain('notizen.example.com')
  })

  it('lässt andere Seiten im Caddyfile unberührt', () => {
    const other = `www.meine-seite.de {\n\troot * /var/www\n\tfile_server\n}\n`
    fs.writeFileSync(caddyfile, `${other}\n# Noted (eingerichtet von install.sh)\nqwikbyte.de {\n\treverse_proxy 127.0.0.1:3000\n}\n`)
    expect(run(['notizen.example.com', '--yes']).code).toBe(0)
    const cf = read(caddyfile)
    expect(cf.startsWith(other)).toBe(true)
    expect(cf).toContain('notizen.example.com {')
    expect(cf).not.toContain('qwikbyte.de')
  })

  it('bricht ab, wenn die Domain nicht auf den Server zeigt', () => {
    let res = run(['notizen.example.com', '--yes'], { FAKE_DNS: '203.0.113.9', FAKE_PUBLIC_IP: '198.51.100.1' })
    expect(res.code).toBe(1)
    expect(res.out).toContain('zeigt nicht auf diesen Server')
    expect(read(caddyfile)).toBe(LEGACY)
    res = run(['notizen.example.com', '--yes'], { FAKE_DNS: '' })
    expect(res.code).toBe(1)
    expect(res.out).toContain('lässt sich nicht auflösen')
    expect(calls()).not.toContain('systemctl')
    // hinter NAT: öffentliche Adresse passt
    expect(run(['notizen.example.com', '--yes'], { FAKE_DNS: '198.51.100.1', FAKE_PUBLIC_IP: '198.51.100.1' }).code).toBe(0)
  })

  it('stellt die vorherige Konfiguration wieder her, wenn HTTPS nicht klappt', () => {
    const res = run(['notizen.example.com', '--yes'], { FAKE_HTTPS_FAIL: '1' })
    expect(res.code).toBe(1)
    expect(res.out).toContain('Vorherige Konfiguration wiederhergestellt – Noted läuft weiter unter https://qwikbyte.de')
    expect(read(caddyfile)).toBe(LEGACY)
    expect(read(path.join(root, '.env'))).toContain('APP_URL=https://qwikbyte.de')
    expect(calls().match(/systemctl reload-or-restart caddy/g)).toHaveLength(2)
    expect(calls()).not.toContain('docker compose')
  })

  it('richtet mit --force ohne Prüfungen ein', () => {
    const res = run(['notizen.example.com', '--yes', '--force'], { FAKE_DNS: '', FAKE_HTTPS_FAIL: '1' })
    expect(res.code).toBe(0)
    expect(res.out).toContain('Ohne Prüfung eingerichtet')
    expect(read(caddyfile)).toContain('notizen.example.com {')
  })

  it('übernimmt eine E-Mail für Let’s Encrypt und behält sie beim nächsten Wechsel', () => {
    expect(run(['notizen.example.com', '--yes', '--email', 'du@example.com']).code).toBe(0)
    expect(read(caddyfile)).toContain('notizen.example.com {\n\ttls du@example.com\n\treverse_proxy 127.0.0.1:3000\n}')
    expect(run(['neu.example.org', '--yes']).code).toBe(0)
    expect(read(caddyfile)).toContain('neu.example.org {\n\ttls du@example.com\n')
    expect(run(['neu.example.org', '--yes', '--email', 'kaputt{@x.de']).out).toContain('Ungültige E-Mail-Adresse')
  })

  it('ersetzt die Beispielkonfiguration des Caddy-Pakets', () => {
    fs.writeFileSync(caddyfile, ':80 {\n\troot * /usr/share/caddy\n\tfile_server\n}\n')
    fs.writeFileSync(path.join(root, '.env'), 'ADMIN_USERNAME=admin\n')
    expect(run([]).out).toContain('Noch keine Domain eingerichtet')
    expect(run(['notizen.example.com', '--yes']).code).toBe(0)
    expect(read(caddyfile)).not.toContain('/usr/share/caddy')
    expect(read(path.join(root, '.env'))).toContain('APP_URL=https://notizen.example.com')
  })

  it('weist ungültige Eingaben ab und fragt ohne --yes nach', () => {
    expect(run(['nicht gültig', '--yes']).out).toContain('Ungültige Domain')
    expect(run(['localhost', '--yes']).out).toContain('Ungültige Domain')
    expect(run(['a.de', 'b.de']).out).toContain('nur eine Domain')
    // ohne Terminal und ohne --yes: keine stille Umstellung
    const res = run(['notizen.example.com'])
    expect(res.code).toBe(1)
    expect(res.out).toContain('mit --yes aufrufen')
    expect(read(caddyfile)).toBe(LEGACY)
  })

  it('lehnt eine ungültige Caddy-Konfiguration ab, ohne etwas zu ändern', () => {
    fs.writeFileSync(caddyfile, `${LEGACY}\n# UNGUELTIG\n`)
    const before = read(caddyfile)
    const res = run(['notizen.example.com', '--yes'])
    expect(res.code).toBe(1)
    expect(res.out).toContain('ungültig')
    expect(read(caddyfile)).toBe(before)
    expect(fs.readdirSync(path.dirname(caddyfile))).toEqual(['Caddyfile'])
  })
})
