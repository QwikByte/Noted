'use client'
// Erkennt neue Versionen nach einem Server-Update: fragt regelmäßig die laufende Version ab und kümmert sich
// um den Service Worker. Ist eine neue Version da, zeigt die App einen Hinweis mit „Neu laden“ (UpdateBanner).
import { api } from '@/shared/client/api'
import { sync } from '@/features/notes/client/sync'
import { BUILD } from '../build'

const CHECK_INTERVAL = 10 * 60_000
/** Mindestabstand zwischen zwei Prüfungen (z. B. beim schnellen Wechseln zwischen Apps) */
const MIN_GAP = 60_000

type UpdateState = { available: boolean; version: string | null }

let state: UpdateState = { available: false, version: null }
const listeners = new Set<() => void>()
let registration: ServiceWorkerRegistration | null = null
let started = false
let lastCheck = 0
let reloading = false

function setState(next: UpdateState) {
  state = next
  for (const fn of listeners) fn()
}

export function subscribeUpdate(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export const getUpdateState = () => state
const NO_UPDATE: UpdateState = { available: false, version: null }
export const getServerUpdateState = () => NO_UPDATE

async function check(force = false) {
  const now = Date.now()
  // Offline gar nicht erst fragen – das „online“-Ereignis holt die Prüfung nach
  if (reloading || navigator.onLine === false || (!force && now - lastCheck < MIN_GAP)) return
  lastCheck = now
  let server: { buildId: string; version: string }
  try {
    server = await api('/api/version')
  } catch {
    return // offline oder Server startet gerade neu – später wieder
  }
  if (server.buildId === BUILD.buildId) {
    // Diese Seite ist schon die neue Version: ein wartender Service Worker gehört dazu und darf übernehmen
    registration?.waiting?.postMessage({ type: 'skip-waiting' })
    return
  }
  setState({ available: true, version: server.version })
  void registration?.update().catch(() => {})
}

/** Registriert den Service Worker und prüft regelmäßig auf neue Versionen (nur im Produktivbetrieb). */
export function startUpdateWatcher() {
  if (started || process.env.NODE_ENV !== 'production') return
  started = true

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        registration = reg
        // Neuer Service Worker fertig installiert → wartet; prüfen, ob er zu dieser Seite gehört
        reg.addEventListener('updatefound', () => {
          const worker = reg.installing
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed' && reg.waiting) void check(true)
          })
        })
        if (reg.waiting) void check(true)
      })
      .catch(() => {})
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) location.reload()
    })
  }

  setInterval(() => {
    if (document.visibilityState === 'visible') void check()
  }, CHECK_INTERVAL)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check()
  })
  window.addEventListener('online', () => void check())
  setTimeout(() => void check(true), 5_000)
}

/** Neue Version laden. Entwürfe liegen ohnehin lokal und werden nach dem Neuladen weiter synchronisiert. */
export function applyUpdate() {
  if (reloading) return
  reloading = true
  sync.flushAll(true)
  const waiting = registration?.waiting
  if (waiting) {
    // Neuer Service Worker übernimmt → „controllerchange“ lädt neu; zur Sicherheit auch ohne dieses Ereignis
    waiting.postMessage({ type: 'skip-waiting' })
    setTimeout(() => location.reload(), 3_000)
  } else {
    location.reload()
  }
}
