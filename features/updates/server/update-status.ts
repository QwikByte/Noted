import 'server-only'
import fs from 'node:fs'
import path from 'node:path'
import { getConfig } from '@/shared/server/config'
import type { UpdateRequest, UpdateRunState, UpdateStatus } from '../types'

const STATES: UpdateRunState[] = ['ok', 'updating', 'failed', 'rolled_back', 'error']

/** Zeilen „KEY=Wert“ (so schreibt sie scripts/auto-update.sh) */
export function parseStatusFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trimEnd())
    if (match) out[match[1]] = match[2]
  }
  return out
}

/** Liest höchstens `maxBytes` vom Ende einer Datei; null, wenn sie fehlt */
function readTail(file: string, maxBytes: number): string | null {
  let fd: number | undefined
  try {
    fd = fs.openSync(file, 'r')
    const { size } = fs.fstatSync(fd)
    const length = Math.min(size, maxBytes)
    const buffer = Buffer.alloc(length)
    fs.readSync(fd, buffer, 0, length, size - length)
    let text = buffer.toString('utf8')
    if (length < size) text = text.slice(text.indexOf('\n') + 1) // angeschnittene erste Zeile weglassen
    return text
  } catch {
    return null
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

/** Steuerzeichen (z. B. Farbcodes aus der Build-Ausgabe) entfernen */
function cleanLog(text: string): string {
  return text
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\r(?!\n)/g, '\n')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
}

const seconds = (value: string | undefined) => {
  const n = Number(value)
  return value && Number.isFinite(n) && n > 0 ? n * 1000 : null
}

// ---- Update-Anfragen aus dem Admin-Bereich ----------------------------------------
// Die App darf nur eine Datei ablegen; den Update-Dienst (scripts/auto-update.sh) startet systemd auf dem Host,
// sobald sie auftaucht. So bekommt der Container keinen Zugriff auf Docker.

const REQUEST_FILE = 'update'

export function canRequestUpdate(): boolean {
  try {
    fs.accessSync(getConfig().updateRequestDir, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

export function readUpdateRequest(): UpdateRequest | null {
  const raw = readTail(path.join(getConfig().updateRequestDir, REQUEST_FILE), 4096)
  if (raw === null) return null
  const r = parseStatusFile(raw)
  return { at: seconds(r.AT), retry: r.ACTION === 'retry', by: r.BY || null }
}

/** Legt die Anfrage ab (überschreibt eine noch nicht abgeholte). */
export function requestUpdate(opts: { retry: boolean; by: string }) {
  const dir = getConfig().updateRequestDir
  const tmp = path.join(dir, `.${REQUEST_FILE}.${process.pid}.tmp`)
  const by = opts.by.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 32)
  fs.writeFileSync(tmp, `ACTION=${opts.retry ? 'retry' : 'check'}\nBY=${by}\nAT=${Math.floor(Date.now() / 1000)}\n`)
  fs.renameSync(tmp, path.join(dir, REQUEST_FILE))
}

export function readUpdateStatus(): UpdateStatus {
  const dir = getConfig().updateDir
  const raw = readTail(path.join(dir, 'status'), 16 * 1024)
  if (raw === null) return { configured: false }
  const s = parseStatusFile(raw)
  const log = readTail(path.join(dir, 'last-run.log'), 48 * 1024)
  return {
    configured: true,
    state: STATES.includes(s.STATE as UpdateRunState) ? (s.STATE as UpdateRunState) : 'unknown',
    checkedAt: seconds(s.CHECKED_AT),
    current: s.CURRENT || null,
    latest: s.LATEST || null,
    updatedAt: seconds(s.UPDATED_AT),
    failedTag: s.FAILED_TAG || null,
    failedAt: seconds(s.FAILED_AT),
    failedStage: s.FAILED_STAGE === 'build' || s.FAILED_STAGE === 'deploy' ? s.FAILED_STAGE : null,
    message: s.MESSAGE || null,
    log: log ? cleanLog(log).trim() || null : null,
  }
}
