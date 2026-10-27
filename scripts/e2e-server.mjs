// Startet den gebauten Standalone-Server mit frischem Datenverzeichnis (für die E2E-Tests).
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const standalone = path.join(root, '.next/standalone')
if (!fs.existsSync(path.join(standalone, 'server.js'))) {
  console.error('Bitte zuerst „npm run build“ ausführen.')
  process.exit(1)
}
fs.cpSync(path.join(root, 'public'), path.join(standalone, 'public'), { recursive: true })
fs.cpSync(path.join(root, '.next/static'), path.join(standalone, '.next/static'), { recursive: true })

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-e2e-'))
// Beispielstatus des Update-Skripts für Administration → System
const updateDir = path.join(dataDir, 'update-status')
const nowSec = Math.floor(Date.now() / 1000)
fs.mkdirSync(path.join(updateDir, 'requests'), { recursive: true })
fs.writeFileSync(
  path.join(updateDir, 'status'),
  `CHECKED_AT=${nowSec - 600}\nSTATE=ok\nCURRENT=v1.2.0\nLATEST=v1.2.0\nUPDATED_AT=${nowSec - 86400}\nMESSAGE=Aktuell (v1.2.0)\n`,
)
fs.writeFileSync(path.join(updateDir, 'last-run.log'), '[2026-10-12 04:00:01] Installiere v1.2.0 (bisher: v1.1.0)\n[2026-10-12 04:02:13] Fertig: v1.2.0 läuft.\n')
const child = spawn(process.execPath, ['server.js'], {
  cwd: standalone,
  stdio: 'inherit',
  env: {
    ...process.env,
    DATA_DIR: dataDir,
    UPDATE_STATUS_DIR: updateDir,
    PORT: process.env.PORT ?? '3100',
    HOSTNAME: '127.0.0.1',
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: process.env.E2E_ADMIN_PASSWORD ?? 'E2E-Admin-Passwort-1',
    // Statt Anthropic ein Nachbau, den e2e/ai.spec.ts startet
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${process.env.E2E_ANTHROPIC_PORT ?? 3199}`,
  },
})
const stop = () => {
  child.kill()
  fs.rmSync(dataDir, { recursive: true, force: true })
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
child.on('exit', (code) => process.exit(code ?? 0))
