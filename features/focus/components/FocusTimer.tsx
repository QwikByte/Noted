'use client'
import { useId, useState } from 'react'
import { ChevronRight, Pause, Play, RotateCcw, SkipForward } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Input, Switch } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { focusTimer, useFocusTimer } from '../client/focus-timer'
import {
  PHASE_LABELS,
  SETTING_LIMITS,
  formatClock,
  isFresh,
  isRunning,
  phaseMs,
  remainingMs,
  type Phase,
  type TimerMode,
  type TimerSettings,
} from '../timer'

const MODES: [TimerMode, string][] = [
  ['pomodoro', 'Pomodoro'],
  ['countdown', 'Countdown'],
]
const COUNTDOWN_PRESETS = [5, 15, 25, 45, 60, 90]

const isBreak = (phase: Phase) => phase === 'shortBreak' || phase === 'longBreak'

/** Inhalt des Fensters „Fokus-Timer“: Pomodoro oder einfacher Countdown */
export function FocusTimer() {
  const { state, settings, notify, now } = useFocusTimer()
  const [showSettings, setShowSettings] = useState(false)
  const running = isRunning(state)
  const fresh = isFresh(state, settings)
  const left = remainingMs(state, now)
  const progress = 1 - left / phaseMs(settings, state.phase)
  const atStart = fresh && state.round === 1 && !isBreak(state.phase)

  return (
    <div className="space-y-4 p-4">
      <div className="flex rounded-lg bg-subtle p-1" role="radiogroup" aria-label="Art des Timers">
        {MODES.map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={state.mode === m}
            // Ein laufender Timer soll nicht versehentlich verloren gehen
            disabled={running && state.mode !== m}
            title={running && state.mode !== m ? 'Erst anhalten' : undefined}
            onClick={() => focusTimer.setMode(m)}
            className={cn(
              'flex-1 rounded-md py-1.5 text-sm font-medium transition-colors disabled:opacity-50',
              state.mode === m ? 'bg-elevated text-fg shadow-sm' : 'text-muted hover:text-fg',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="text-center">
        <p className={cn('text-sm font-medium', isBreak(state.phase) ? 'text-success' : 'text-accent-text')} data-testid="focus-phase">
          {PHASE_LABELS[state.phase]}
          {state.mode === 'pomodoro' ? (
            <span className="font-normal text-muted">
              {' '}
              · Runde {state.round} von {settings.rounds}
            </span>
          ) : null}
        </p>
        <p className="mt-1 text-5xl font-semibold tracking-tight tabular-nums" role="timer" data-testid="focus-clock">
          {formatClock(left)}
        </p>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-subtle">
          <div
            className={cn('h-full rounded-full transition-[width] duration-300', isBreak(state.phase) ? 'bg-success' : 'bg-accent')}
            style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
          />
        </div>
      </div>

      <div className="flex items-center justify-center gap-2">
        <Button variant="ghost" size="icon" aria-label="Zurücksetzen" title="Zurücksetzen" disabled={atStart} onClick={focusTimer.reset}>
          <RotateCcw className="size-5" />
        </Button>
        {/* „Anhalten“ statt „Pause“ – „Pause“ ist hier schon eine Phase */}
        <Button variant="primary" size="lg" className="w-32" onClick={running ? focusTimer.pause : focusTimer.start}>
          {running ? <Pause className="size-5" /> : <Play className="size-5" />}
          {running ? 'Anhalten' : fresh ? 'Start' : 'Weiter'}
        </Button>
        {state.mode === 'pomodoro' ? (
          <Button variant="ghost" size="icon" aria-label="Nächste Phase" title="Nächste Phase" onClick={focusTimer.skip}>
            <SkipForward className="size-5" />
          </Button>
        ) : (
          <span className="size-10" />
        )}
      </div>

      {state.mode === 'countdown' && !running ? (
        <div className="flex flex-wrap justify-center gap-1.5" role="group" aria-label="Dauer">
          {COUNTDOWN_PRESETS.map((min) => (
            <button
              key={min}
              type="button"
              aria-pressed={settings.countdown === min}
              onClick={() => {
                focusTimer.updateSettings({ countdown: min })
                focusTimer.reset()
              }}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                settings.countdown === min
                  ? 'border-accent bg-accent-soft text-accent-text'
                  : 'border-border text-muted hover:bg-hover hover:text-fg',
              )}
            >
              {min} min
            </button>
          ))}
        </div>
      ) : null}

      <div className="border-t border-border pt-3">
        <button
          type="button"
          aria-expanded={showSettings}
          onClick={() => setShowSettings((v) => !v)}
          className="flex w-full items-center gap-1.5 text-sm font-medium text-muted hover:text-fg"
        >
          <ChevronRight className={cn('size-4 transition-transform', showSettings && 'rotate-90')} />
          Einstellungen
        </button>
        {showSettings ? (
          <div className="mt-3 space-y-4">
            {state.mode === 'pomodoro' ? (
              <div className="grid grid-cols-3 gap-2">
                <NumberSetting label="Fokus (min)" field="focus" settings={settings} />
                <NumberSetting label="Pause (min)" field="shortBreak" settings={settings} />
                <NumberSetting label="Lange (min)" field="longBreak" settings={settings} />
                <NumberSetting label="Runden bis zur langen Pause" field="rounds" settings={settings} className="col-span-3" />
              </div>
            ) : (
              <NumberSetting label="Eigene Dauer (min)" field="countdown" settings={settings} />
            )}
            <NotifySetting on={notify} />
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** Zahl erst beim Verlassen des Felds (oder Enter) übernehmen – sonst springt sie beim Tippen auf die Grenzen */
function NumberSetting({
  label,
  field,
  settings,
  className,
}: {
  label: string
  field: keyof TimerSettings
  settings: TimerSettings
  className?: string
}) {
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const { min, max } = SETTING_LIMITS[field]
  const commit = () => {
    if (draft === null) return
    const n = Number(draft)
    if (draft.trim() && Number.isFinite(n)) focusTimer.updateSettings({ [field]: n })
    setDraft(null)
  }
  return (
    <div className={cn('space-y-1', className)}>
      <label htmlFor={id} className="block text-xs font-medium text-muted">
        {label}
      </label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        className="h-9 px-2.5 text-sm"
        value={draft ?? String(settings[field])}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
      />
    </div>
  )
}

function NotifySetting({ on }: { on: boolean }) {
  const supported = typeof Notification !== 'undefined'
  const denied = supported && Notification.permission === 'denied'
  return (
    <Switch
      checked={on && supported && !denied}
      onChange={(v) => void focusTimer.setNotify(v)}
      disabled={!supported || denied}
      label="Systembenachrichtigung"
      description={
        !supported
          ? 'Dieser Browser kann keine Benachrichtigungen anzeigen.'
          : denied
            ? 'Im Browser blockiert – erlaube sie in den Website-Einstellungen.'
            : 'Meldet das Ende einer Phase auch, wenn du gerade nicht in Noted bist.'
      }
    />
  )
}

/** Restzeit für die Werkzeugleiste – nur, wenn der Timer läuft oder angehalten ist */
export function FocusTimerBadge() {
  const { state, settings, now } = useFocusTimer()
  if (isFresh(state, settings)) return null
  return (
    <span
      className={cn(
        'text-xs font-semibold tabular-nums',
        !isRunning(state) ? 'text-muted' : isBreak(state.phase) ? 'text-success' : 'text-accent-text',
      )}
      data-testid="focus-badge"
    >
      {formatClock(remainingMs(state, now))}
    </span>
  )
}
