// Fokus-Timer: Pomodoro (Fokus und Pausen im Wechsel) oder einfacher Countdown. Reine Logik ohne Browser-Abhängigkeit.

export type TimerMode = 'pomodoro' | 'countdown'
export type Phase = 'focus' | 'shortBreak' | 'longBreak' | 'countdown'

/** Dauern in Minuten */
export type TimerSettings = {
  focus: number
  shortBreak: number
  longBreak: number
  /** Fokus-Runden bis zur langen Pause */
  rounds: number
  countdown: number
}

export type TimerState = {
  mode: TimerMode
  phase: Phase
  /** Laufende Fokus-Runde (1 … rounds) */
  round: number
  /** Ende der Phase (ms seit 1970), solange der Timer läuft – sonst null */
  endsAt: number | null
  /** Restzeit in ms, solange der Timer steht */
  remaining: number
}

const MINUTE = 60_000

/** Wer so spät zurückkommt (z. B. Laptop zugeklappt), bekommt für eine längst vergangene Phase keinen Ton mehr */
export const LATE_MS = MINUTE

export const DEFAULT_SETTINGS: TimerSettings = { focus: 25, shortBreak: 5, longBreak: 15, rounds: 4, countdown: 25 }

export const SETTING_LIMITS: Record<keyof TimerSettings, { min: number; max: number }> = {
  focus: { min: 1, max: 180 },
  shortBreak: { min: 1, max: 60 },
  longBreak: { min: 1, max: 120 },
  rounds: { min: 1, max: 12 },
  countdown: { min: 1, max: 600 },
}

export const PHASE_LABELS: Record<Phase, string> = {
  focus: 'Fokus',
  shortBreak: 'Kurze Pause',
  longBreak: 'Lange Pause',
  countdown: 'Countdown',
}

const clampSetting = (key: keyof TimerSettings, value: unknown): number => {
  const { min, max } = SETTING_LIMITS[key]
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : DEFAULT_SETTINGS[key]
  return Math.min(max, Math.max(min, n))
}

/** Einstellungen aus dem Speicher – Unbekanntes oder Unsinniges fällt auf die Standardwerte zurück */
export function normalizeSettings(raw: unknown): TimerSettings {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const keys = Object.keys(DEFAULT_SETTINGS) as (keyof TimerSettings)[]
  return Object.fromEntries(keys.map((k) => [k, clampSetting(k, obj[k])])) as TimerSettings
}

export function phaseMs(settings: TimerSettings, phase: Phase): number {
  return settings[phase === 'countdown' ? 'countdown' : phase] * MINUTE
}

export function initialState(mode: TimerMode, settings: TimerSettings): TimerState {
  const phase: Phase = mode === 'pomodoro' ? 'focus' : 'countdown'
  return { mode, phase, round: 1, endsAt: null, remaining: phaseMs(settings, phase) }
}

/** Gespeicherter Zustand – passt er nicht zu den Einstellungen, beginnt der Timer von vorn */
export function parseState(raw: unknown, settings: TimerSettings): TimerState {
  const s = raw && typeof raw === 'object' ? (raw as Partial<TimerState>) : {}
  const mode: TimerMode = s.mode === 'countdown' ? 'countdown' : 'pomodoro'
  const phases: Phase[] = mode === 'pomodoro' ? ['focus', 'shortBreak', 'longBreak'] : ['countdown']
  const fresh = initialState(mode, settings)
  if (!phases.includes(s.phase as Phase)) return fresh
  const phase = s.phase as Phase
  const full = phaseMs(settings, phase)
  const round = Number.isInteger(s.round) ? Math.min(settings.rounds, Math.max(1, s.round as number)) : 1
  const endsAt = typeof s.endsAt === 'number' && Number.isFinite(s.endsAt) ? s.endsAt : null
  const remaining =
    typeof s.remaining === 'number' && s.remaining > 0 && s.remaining <= full ? s.remaining : full
  return { mode, phase, round, endsAt, remaining }
}

export const isRunning = (state: TimerState) => state.endsAt !== null

export function remainingMs(state: TimerState, now: number): number {
  return state.endsAt === null ? state.remaining : Math.max(0, state.endsAt - now)
}

/** Steht der Timer am Anfang der Phase (noch nicht gestartet)? */
export function isFresh(state: TimerState, settings: TimerSettings): boolean {
  return !isRunning(state) && state.remaining === phaseMs(settings, state.phase)
}

export function start(state: TimerState, now: number): TimerState {
  return isRunning(state) ? state : { ...state, endsAt: now + state.remaining }
}

export function pause(state: TimerState, now: number): TimerState {
  return isRunning(state) ? { ...state, endsAt: null, remaining: Math.max(1, remainingMs(state, now)) } : state
}

function nextPhase(state: TimerState, settings: TimerSettings): Pick<TimerState, 'phase' | 'round'> {
  switch (state.phase) {
    case 'focus':
      return { phase: state.round >= settings.rounds ? 'longBreak' : 'shortBreak', round: state.round }
    case 'shortBreak':
      return { phase: 'focus', round: state.round + 1 }
    case 'longBreak':
      return { phase: 'focus', round: 1 }
    case 'countdown':
      return { phase: 'countdown', round: 1 }
  }
}

/** Zur nächsten Phase springen; läuft der Timer, läuft er gleich weiter */
export function skip(state: TimerState, settings: TimerSettings, now: number): TimerState {
  const next = nextPhase(state, settings)
  const full = phaseMs(settings, next.phase)
  return { ...state, ...next, endsAt: isRunning(state) ? now + full : null, remaining: full }
}

/**
 * Ist die laufende Phase vorbei, geht es mit der nächsten weiter – gerechnet ab dem Ende der alten Phase, damit
 * mehrere offene Tabs dasselbe Ergebnis bekommen. Wäre auch die nächste Phase schon vorbei (niemand war da), bleibt
 * der Timer am Anfang der nächsten Phase stehen. Ein Countdown steht nach dem Ablauf wieder am Anfang.
 */
export function settle(
  state: TimerState,
  settings: TimerSettings,
  now: number,
): { state: TimerState; ended: { phase: Phase; at: number } | null } {
  if (state.endsAt === null || state.endsAt > now) return { state, ended: null }
  const ended = { phase: state.phase, at: state.endsAt }
  if (state.mode === 'countdown') return { state: initialState('countdown', settings), ended }
  const next = nextPhase(state, settings)
  const full = phaseMs(settings, next.phase)
  const endsAt = state.endsAt + full
  return {
    state: endsAt > now ? { ...state, ...next, endsAt, remaining: full } : { ...state, ...next, endsAt: null, remaining: full },
    ended,
  }
}

/** Neue Einstellungen übernehmen: Eine noch nicht gestartete Phase bekommt die neue Dauer, eine laufende nicht */
export function applySettings(state: TimerState, before: TimerSettings, after: TimerSettings): TimerState {
  const round = Math.min(state.round, after.rounds)
  const remaining = isFresh(state, before) ? phaseMs(after, state.phase) : Math.min(state.remaining, phaseMs(after, state.phase))
  return { ...state, round, remaining }
}

/** Meldung, wenn eine Phase vorbei ist */
export function endMessage(ended: Phase, next: TimerState, settings: TimerSettings): { title: string; body: string } {
  if (ended === 'countdown') return { title: 'Zeit ist um', body: `Der Countdown (${settings.countdown} min) ist abgelaufen.` }
  if (ended === 'focus') {
    const long = next.phase === 'longBreak'
    return {
      title: 'Fokus-Runde geschafft',
      body: `Zeit für eine ${long ? 'lange' : 'kurze'} Pause (${long ? settings.longBreak : settings.shortBreak} min).`,
    }
  }
  return { title: 'Pause vorbei', body: `Weiter geht’s mit Runde ${next.round} von ${settings.rounds}.` }
}

/** Restzeit als Uhr: „25:00“, ab einer Stunde „1:05:00“ */
export function formatClock(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}
