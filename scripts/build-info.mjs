#!/usr/bin/env node
// Läuft vor jedem Produktions-Build (npm „prebuild“):
// - schreibt die Versionsinfos nach .build-info.json (liest next.config.ts)
// - erzeugt public/sw.js aus sw/service-worker.js mit der Build-ID, damit Browser neue Versionen erkennen
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

const placeholder = "'__NOTED_BUILD_ID__'"
const template = fs.readFileSync(path.join(root, 'sw/service-worker.js'), 'utf8')
if (!template.includes(placeholder)) throw new Error(`Platzhalter ${placeholder} fehlt in sw/service-worker.js`)
fs.writeFileSync(path.join(root, 'public/sw.js'), template.replace(placeholder, JSON.stringify(info.buildId)))

console.log(`Noted ${info.version}${info.commit ? ` (${info.commit})` : ''} – Build ${info.buildId}`)
