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
const child = spawn(process.execPath, ['server.js'], {
  cwd: standalone,
  stdio: 'inherit',
  env: {
    ...process.env,
    DATA_DIR: dataDir,
    PORT: process.env.PORT ?? '3100',
    HOSTNAME: '127.0.0.1',
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: process.env.E2E_ADMIN_PASSWORD ?? 'E2E-Admin-Passwort-1',
  },
})
const stop = () => {
  child.kill()
  fs.rmSync(dataDir, { recursive: true, force: true })
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
child.on('exit', (code) => process.exit(code ?? 0))
