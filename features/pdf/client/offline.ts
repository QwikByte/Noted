'use client'
// PDFs offline verfügbar halten: eine Liste je Gerät und Konto (beim Abmelden gelöscht), „zuletzt geöffnet“ für das
// Budget, und Aufräumen des Offline-Speichers des Service Workers (Cache „noted-data“)
import { useEffect, useState, useSyncExternalStore } from 'react'
import { fetchPdf } from './pdfjs'
import { entriesToDelete, type CacheEntry } from '../offline'
import type { Attachment } from '@/features/attachments/types'

export const OFFLINE_KEY = 'noted:pdf:offline'
export const OPENED_KEY = 'noted:pdf:opened'
/** Wie im Service Worker – Dateien liegen dort unter /api/files/<Name> und /api/attachments/<ID> */
const DATA_CACHE = 'noted-data'
/** Höchstens so viele PDFs in „zuletzt geöffnet“ merken */
const MAX_OPENED = 200

const listeners = new Set<() => void>()
let pinnedSnapshot: ReadonlySet<string> | null = null

function readJson<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Speicher voll – dann eben ohne
  }
}

function pinned(): ReadonlySet<string> {
  pinnedSnapshot ??= new Set(readJson<string[]>(OFFLINE_KEY, []))
  return pinnedSnapshot
}

function setPinned(next: Set<string>) {
  writeJson(OFFLINE_KEY, [...next])
  pinnedSnapshot = next
  for (const fn of listeners) fn()
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  // Markiert in einem anderen Tab
  const onStorage = (e: StorageEvent) => {
    if (e.key !== OFFLINE_KEY && e.key !== null) return
    pinnedSnapshot = null
    fn()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(fn)
    window.removeEventListener('storage', onStorage)
  }
}
const EMPTY: ReadonlySet<string> = new Set()

/** Als „Offline verfügbar“ markierte PDFs (Dateinamen klein geschrieben) */
export function usePinnedPdfs(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, pinned, () => EMPTY)
}

/** Merken, wann ein PDF zuletzt geöffnet wurde – danach richtet sich, was über dem Budget zuerst geht */
export function rememberOpened(filename: string) {
  const opened = readJson<Record<string, number>>(OPENED_KEY, {})
  delete opened[filename.toLowerCase()]
  opened[filename.toLowerCase()] = Date.now()
  writeJson(OPENED_KEY, Object.fromEntries(Object.entries(opened).slice(-MAX_OPENED)))
}

/**
 * PDF in den Offline-Speicher laden und markieren. Beim ersten Mal bittet Noted den Browser, den Speicher nicht bei
 * Platzmangel zu räumen.
 */
export async function makePdfOffline(filename: string): Promise<void> {
  await fetchPdf(filename)
  const next = new Set(pinned())
  if (next.size === 0) void navigator.storage?.persist?.().catch(() => false)
  next.add(filename.toLowerCase())
  setPinned(next)
}

/** Markierung aufheben – die Datei bleibt im Speicher, bis sie das Budget verdrängt */
export function unpinPdf(filename: string) {
  const next = new Set(pinned())
  next.delete(filename.toLowerCase())
  setPinned(next)
}

/** Datei hinter einer Adresse im Offline-Speicher – über den Namen (/api/files/…) oder die ID (/api/attachments/…) */
function fileOf(path: string, byName: Map<string, Attachment>, byId: Map<string, Attachment>): Attachment | null | undefined {
  const file = /^\/api\/files\/(.+)$/.exec(path)
  if (file) {
    try {
      return byName.get(decodeURIComponent(file[1]).split('/').pop()!.toLowerCase()) ?? null
    } catch {
      return null
    }
  }
  const attachment = /^\/api\/attachments\/([0-9a-f-]{36})(\/.+)?$/.exec(path)
  if (attachment) {
    const found = byId.get(attachment[1])
    // Anmerkungen und Rückverweise zählen nicht zum Budget, gehen aber mit der Datei
    if (attachment[2]) return found ? undefined : null
    return found ?? null
  }
  // Keine Datei (Notizen, Ordner …)
  return undefined
}

/**
 * Offline-Speicher aufräumen: Einträge gelöschter Dateien entfernen (sonst zeigte der Viewer offline womöglich eine
 * alte Datei gleichen Namens) und nicht markierte PDFs über dem Budget. `files` muss frisch vom Server kommen – eine
 * ältere Liste kennt neue Dateien nicht, deren Einträge gingen sonst mit. Offline (Liste aus dem Cache) passiert nichts.
 */
export async function pruneOfflineFiles(files: Attachment[]) {
  if (!('caches' in window) || !navigator.onLine) return
  try {
    const cache = await caches.open(DATA_CACHE)
    const byName = new Map(files.map((f) => [f.filename.toLowerCase(), f]))
    const byId = new Map(files.map((f) => [f.id, f]))
    const opened = readJson<Record<string, number>>(OPENED_KEY, {})
    const entries: CacheEntry[] = []
    const remove: string[] = []
    for (const request of await cache.keys()) {
      const url = new URL(request.url)
      // Downloads früherer Versionen lagen ein zweites Mal im Speicher
      if (url.searchParams.has('download')) {
        remove.push(request.url)
        continue
      }
      const file = fileOf(url.pathname, byName, byId)
      if (file === undefined) continue
      entries.push({
        key: request.url,
        file: file && { name: file.filename, size: file.size, pdf: file.mime === 'application/pdf' },
        opened: file ? (opened[file.filename.toLowerCase()] ?? 0) : 0,
      })
    }
    for (const key of [...remove, ...entriesToDelete(entries, pinned())]) await cache.delete(key)
  } catch {
    // Dann beim nächsten Mal
  }
}

/**
 * Belegter Offline-Speicher in Bytes (Schätzung des Browsers) – null, wenn der Browser es nicht verrät. Neu geschätzt,
 * wenn sich `refresh` oder die Markierungen ändern.
 */
export function useOfflineUsage(refresh: unknown): number | null {
  const [usage, setUsage] = useState<number | null>(null)
  const pinnedPdfs = usePinnedPdfs()
  useEffect(() => {
    let active = true
    void navigator.storage?.estimate?.().then(
      (e) => active && setUsage(e.usage ?? null),
      () => {},
    )
    return () => {
      active = false
    }
  }, [refresh, pinnedPdfs])
  return usage
}
