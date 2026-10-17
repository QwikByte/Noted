'use client'
// Laufender Fokus-Timer. Der Zustand liegt im localStorage: Er übersteht Neuladen und gilt für alle offenen Tabs.
// Am Ende einer Phase: Ton, Meldung in der App und auf Wunsch eine Systembenachrichtigung.
import { useEffect, useSyncExternalStore } from 'react'
import { useToast } from '@/shared/ui/toast'
import {
  DEFAULT_SETTINGS,
  LATE_MS,
  applySettings,
  endMessage,
  initialState,
  normalizeSettings,
  parseState,
  pause,
  settle,
  skip,
  start,
  type TimerMode,
  type TimerSettings,
  type TimerState,
} from '../timer'

const STATE_KEY = 'noted:focus:state'
const SETTINGS_KEY = 'noted:focus:settings'
const NOTIFY_KEY = 'noted:focus:notify'

type FocusSnapshot = {
  state: TimerState
  settings: TimerSettings
  /** Systembenachrichtigung am Ende einer Phase */
  notify: boolean
  /** Zeitpunkt der Anzeige – wird jede Viertelsekunde erneuert, solange der Timer läuft */
  now: number
}

type EndMessage = { title: string; body: string }

const SERVER_SNAPSHOT: FocusSnapshot = {
  state: initialState('pomodoro', DEFAULT_SETTINGS),
  settings: DEFAULT_SETTINGS,
  notify: false,
  now: 0,
}

function readItem(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function readJson(key: string): unknown {
  try {
    return JSON.parse(readItem(key) ?? 'null')
  } catch {
    return null
  }
}

function writeItem(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* privat/voll */
  }
}

const listeners = new Set<() => void>()
const endListeners = new Set<(message: EndMessage) => void>()
let cache: FocusSnapshot | null = null
let endTimer: ReturnType<typeof setTimeout> | undefined
let ticker: ReturnType<typeof setInterval> | undefined

function load(): FocusSnapshot {
  const settings = normalizeSettings(readJson(SETTINGS_KEY))
  return { settings, state: parseState(readJson(STATE_KEY), settings), notify: readItem(NOTIFY_KEY) === '1', now: Date.now() }
}

function snapshot(): FocusSnapshot {
  cache ??= load()
  return cache
}

function emit() {
  for (const fn of listeners) fn()
}

function changed() {
  cache = null
  emit()
  schedule()
}

function save(state: TimerState) {
  writeItem(STATE_KEY, JSON.stringify(state))
  changed()
}

function schedule() {
  clearTimeout(endTimer)
  endTimer = undefined
  const { state } = snapshot()
  const running = listeners.size > 0 && state.endsAt !== null
  if (!running) {
    clearInterval(ticker)
    ticker = undefined
    return
  }
  // Ein einzelner Timer genau aufs Ende: Den drosselt der Browser in Hintergrund-Tabs weniger als einen Sekundentakt
  endTimer = setTimeout(settleNow, Math.max(0, (state.endsAt ?? 0) - Date.now()) + 50)
  ticker ??= setInterval(() => {
    if (cache) cache = { ...cache, now: Date.now() }
    emit()
  }, 250)
  armAudio()
}

function settleNow() {
  // Frisch lesen: Ein anderer Tab hat die Phase vielleicht schon weitergeschaltet
  cache = null
  const { state, settings, notify } = snapshot()
  const now = Date.now()
  const result = settle(state, settings, now)
  if (!result.ended) {
    schedule()
    return
  }
  save(result.state)
  if (now - result.ended.at < LATE_MS) signal(endMessage(result.ended.phase, result.state, settings), notify)
}

function onStorage(e: StorageEvent) {
  if (e.key === null || e.key.startsWith('noted:focus:')) changed()
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  if (listeners.size === 1) {
    window.addEventListener('storage', onStorage)
    // Zurück im Tab: verpasste Phasenwechsel sofort nachholen
    document.addEventListener('visibilitychange', settleNow)
    queueMicrotask(settleNow)
  }
  return () => {
    listeners.delete(fn)
    if (listeners.size > 0) return
    window.removeEventListener('storage', onStorage)
    document.removeEventListener('visibilitychange', settleNow)
    schedule()
  }
}

// Ton per Web Audio – Browser erlauben ihn erst nach einer Eingabe auf der Seite
let audio: AudioContext | null = null

function unlockAudio() {
  try {
    audio ??= new AudioContext()
    if (audio.state === 'suspended') void audio.resume()
  } catch {
    /* kein Ton möglich */
  }
}

/** Nach dem Neuladen bei laufendem Timer: Ton mit der nächsten Eingabe freischalten */
function armAudio() {
  if (audio?.state === 'running') return
  window.addEventListener('pointerdown', unlockAudio, { once: true, capture: true })
  window.addEventListener('keydown', unlockAudio, { once: true, capture: true })
}

/** Drei kurze, aufsteigende Töne */
function chime() {
  const ctx = audio
  if (ctx?.state !== 'running') return
  for (const [i, freq] of [660, 880, 1320].entries()) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    const t = ctx.currentTime + i * 0.18
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.2, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + 0.65)
  }
}

function notifySystem({ title, body }: EndMessage) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  // Gleicher tag: Mehrere Tabs oder Runden ersetzen die Benachrichtigung, statt sie zu stapeln
  const options: NotificationOptions = { body, tag: 'noted-focus', icon: '/icons/icon-192.png' }
  try {
    const n = new Notification(title, options)
    n.onclick = () => {
      window.focus()
      n.close()
    }
  } catch {
    // Android erlaubt Benachrichtigungen nur über den Service Worker
    void navigator.serviceWorker?.ready.then((reg) => reg.showNotification(title, options)).catch(() => {})
  }
}

function signal(message: EndMessage, notify: boolean) {
  chime()
  for (const fn of endListeners) fn(message)
  // Wer gerade in der App ist, sieht die Meldung schon
  if (notify && !document.hasFocus()) notifySystem(message)
}

export const focusTimer = {
  start() {
    unlockAudio()
    save(start(snapshot().state, Date.now()))
  },
  pause() {
    save(pause(snapshot().state, Date.now()))
  },
  /** Alles auf Anfang: erste Runde, Timer steht */
  reset() {
    const { state, settings } = snapshot()
    save(initialState(state.mode, settings))
  },
  skip() {
    const { state, settings } = snapshot()
    save(skip(state, settings, Date.now()))
  },
  /** Countdown mit eigener Dauer sofort starten, z. B. für einen eingeplanten Lernblock im Kalender */
  startCountdown(minutes: number) {
    const next = normalizeSettings({ ...snapshot().settings, countdown: minutes })
    writeItem(SETTINGS_KEY, JSON.stringify(next))
    unlockAudio()
    save(start(initialState('countdown', next), Date.now()))
  },
  setMode(mode: TimerMode) {
    const { state, settings } = snapshot()
    if (mode !== state.mode) save(initialState(mode, settings))
  },
  updateSettings(patch: Partial<TimerSettings>) {
    const { state, settings } = snapshot()
    const next = normalizeSettings({ ...settings, ...patch })
    writeItem(SETTINGS_KEY, JSON.stringify(next))
    save(applySettings(state, settings, next))
  },
  /** Einschalten fragt erst jetzt nach der Erlaubnis des Browsers; lehnt er ab, bleibt es aus */
  async setNotify(on: boolean) {
    const allowed =
      !on ||
      (typeof Notification !== 'undefined' &&
        (Notification.permission === 'granted' || (await Notification.requestPermission()) === 'granted'))
    if (allowed) writeItem(NOTIFY_KEY, on ? '1' : '0')
    // Auch bei Ablehnung neu zeichnen: Die Einstellung zeigt dann den Hinweis „blockiert“
    changed()
  },
}

export function useFocusTimer(): FocusSnapshot {
  return useSyncExternalStore(subscribe, snapshot, () => SERVER_SNAPSHOT)
}

/** Meldung in der App, wenn eine Phase vorbei ist */
export function useFocusAlerts() {
  const toast = useToast()
  useEffect(() => {
    const show = ({ title, body }: EndMessage) => toast.show(`${title} – ${body}`, { tone: 'success', duration: 8000 })
    endListeners.add(show)
    return () => {
      endListeners.delete(show)
    }
  }, [toast])
}
