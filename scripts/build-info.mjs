#!/usr/bin/env node
// Läuft vor jedem Produktions-Build (npm „prebuild“):
// - schreibt die Versionsinfos nach .build-info.json (liest next.config.ts)
// - erzeugt public/sw.js aus sw/service-worker.js mit der Build-ID, damit Browser neue Versionen erkennen, und der
//   Version von pdf.js, damit der Service Worker dessen Dateien nur bei einem Wechsel neu lädt
//
// Version: APP_VERSION (setzt scripts/auto-update.sh als Docker-Build-Argument), sonst ein Git-Tag genau
// auf dem aktuellen Commit, sonst „dev“.
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')

function git(...args) {
  try {
    return execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return '' // kein Git (z. B. im Docker-Build) oder kein Tag
  }
}

/** Nur Zeichen, die gefahrlos in URLs (?dpl=…) und Dateinamen landen können */
const clean = (value, max) => String(value ?? '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, max)

const version = clean(process.env.APP_VERSION, 40) || clean(git('describe', '--tags', '--exact-match', 'HEAD'), 40) || 'dev'
const commit = clean(process.env.GIT_COMMIT, 40) || clean(git('rev-parse', '--short=12', 'HEAD'), 40)
const info = {
  version,
  commit,
  buildDate: new Date().toISOString(),
  // Next.js erlaubt in der deploymentId nur Buchstaben, Ziffern, - und _
  buildId: `${version.replace(/[^A-Za-z0-9_-]/g, '_')}-${crypto.randomBytes(5).toString('hex')}`,
}
fs.writeFileSync(path.join(root, '.build-info.json'), JSON.stringify(info, null, 2) + '\n')

// pdf.js-Version aus derselben Quelle wie scripts/vendor-pdfjs.mjs, das die Dateien nach public/pdfjs kopiert
const pdfjs = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/pdfjs-dist/package.json'), 'utf8'))
const placeholders = { "'__NOTED_BUILD_ID__'": info.buildId, "'__NOTED_PDFJS_VERSION__'": clean(pdfjs.version, 40) }
let sw = fs.readFileSync(path.join(root, 'sw/service-worker.js'), 'utf8')
for (const [placeholder, value] of Object.entries(placeholders)) {
  if (!sw.includes(placeholder)) throw new Error(`Platzhalter ${placeholder} fehlt in sw/service-worker.js`)
  sw = sw.replace(placeholder, JSON.stringify(value))
}
fs.writeFileSync(path.join(root, 'public/sw.js'), sw)

console.log(`Noted ${info.version}${info.commit ? ` (${info.commit})` : ''} – Build ${info.buildId}`)
