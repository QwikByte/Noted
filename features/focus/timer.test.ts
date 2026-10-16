import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  applySettings,
  endMessage,
  formatClock,
  initialState,
  isFresh,
  normalizeSettings,
  parseState,
  pause,
  remainingMs,
  settle,
  skip,
  start,
  type TimerSettings,
} from './timer'

const NOW = new Date('2026-10-16T10:00:00').getTime()
const MIN = 60_000
const S: TimerSettings = DEFAULT_SETTINGS

describe('Start, Pause, Weiter', () => {
  it('rechnet die Restzeit über eine Pause hinweg weiter', () => {
    let t = start(initialState('pomodoro', S), NOW)
    expect(remainingMs(t, NOW + 10 * MIN)).toBe(15 * MIN)
    t = pause(t, NOW + 10 * MIN)
    expect(t.endsAt).toBeNull()
    // Steht der Timer, vergeht keine Zeit
    expect(remainingMs(t, NOW + 60 * MIN)).toBe(15 * MIN)
    t = start(t, NOW + 60 * MIN)
    expect(t.endsAt).toBe(NOW + 75 * MIN)
  })

  it('ein frischer Timer steht am Anfang, ein pausierter nicht', () => {
    const t = initialState('pomodoro', S)
    expect(isFresh(t, S)).toBe(true)
    expect(isFresh(pause(start(t, NOW), NOW + 1000), S)).toBe(false)
    expect(isFresh(start(t, NOW), S)).toBe(false)
  })
})

describe('Phasenwechsel (Pomodoro)', () => {
  it('Fokus → kurze Pause → Fokus der nächsten Runde, ohne anzuhalten', () => {
    const t = start(initialState('pomodoro', S), NOW)
    const a = settle(t, S, NOW + 25 * MIN)
    expect(a.ended).toEqual({ phase: 'focus', at: NOW + 25 * MIN })
    expect(a.state).toMatchObject({ phase: 'shortBreak', round: 1, endsAt: NOW + 30 * MIN })
    const b = settle(a.state, S, NOW + 30 * MIN + 500)
    expect(b.ended?.phase).toBe('shortBreak')
    expect(b.state).toMatchObject({ phase: 'focus', round: 2, endsAt: NOW + 55 * MIN })
  })

  it('nach der letzten Runde kommt die lange Pause, danach beginnt Runde 1', () => {
    const t = { ...start(initialState('pomodoro', S), NOW), round: 4 }
    const a = settle(t, S, NOW + 25 * MIN)
    expect(a.state).toMatchObject({ phase: 'longBreak', round: 4, endsAt: NOW + 40 * MIN })
    const b = settle(a.state, S, NOW + 40 * MIN)
    expect(b.state).toMatchObject({ phase: 'focus', round: 1 })
  })

  it('vor dem Ende passiert nichts', () => {
    const t = start(initialState('pomodoro', S), NOW)
    expect(settle(t, S, NOW + 25 * MIN - 1)).toEqual({ state: t, ended: null })
    expect(settle(initialState('pomodoro', S), S, NOW + 99 * MIN).ended).toBeNull()
  })

  it('war niemand da, bleibt der Timer am Anfang der nächsten Phase stehen', () => {
    const t = start(initialState('pomodoro', S), NOW)
    const { state, ended } = settle(t, S, NOW + 2 * 60 * MIN)
    expect(ended?.phase).toBe('focus')
    expect(state).toMatchObject({ phase: 'shortBreak', endsAt: null, remaining: 5 * MIN })
  })

  it('mehrere Tabs kommen zum selben Ergebnis, egal wann sie es merken', () => {
    const t = start(initialState('pomodoro', S), NOW)
    expect(settle(t, S, NOW + 25 * MIN + 100).state).toEqual(settle(t, S, NOW + 25 * MIN + 900).state)
  })

  it('Überspringen geht zur nächsten Phase – laufend oder angehalten', () => {
    const running = skip(start(initialState('pomodoro', S), NOW), S, NOW + MIN)
    expect(running).toMatchObject({ phase: 'shortBreak', endsAt: NOW + 6 * MIN })
    const stopped = skip(initialState('pomodoro', S), S, NOW)
    expect(stopped).toMatchObject({ phase: 'shortBreak', endsAt: null, remaining: 5 * MIN })
    expect(skip(stopped, S, NOW)).toMatchObject({ phase: 'focus', round: 2 })
  })
})

describe('Countdown', () => {
  it('steht nach dem Ablauf wieder am Anfang', () => {
    const t = start(initialState('countdown', { ...S, countdown: 45 }), NOW)
    const { state, ended } = settle(t, { ...S, countdown: 45 }, NOW + 45 * MIN)
    expect(ended?.phase).toBe('countdown')
    expect(state).toEqual({ mode: 'countdown', phase: 'countdown', round: 1, endsAt: null, remaining: 45 * MIN })
  })
})

describe('Einstellungen', () => {
  it('fehlende, falsche und zu große Werte werden ersetzt bzw. begrenzt', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ focus: 50, shortBreak: 'x', longBreak: 0, rounds: 99, countdown: 7.6 })).toEqual({
      focus: 50,
      shortBreak: 5,
      longBreak: 1,
      rounds: 12,
      countdown: 8,
    })
  })

  it('eine nicht gestartete Phase übernimmt die neue Dauer, eine pausierte wird höchstens gekürzt', () => {
    const fresh = initialState('pomodoro', S)
    expect(applySettings(fresh, S, { ...S, focus: 50 }).remaining).toBe(50 * MIN)
    const paused = pause(start(fresh, NOW), NOW + 5 * MIN)
    expect(applySettings(paused, S, { ...S, focus: 50 }).remaining).toBe(20 * MIN)
    expect(applySettings(paused, S, { ...S, focus: 10 }).remaining).toBe(10 * MIN)
    expect(applySettings({ ...fresh, round: 4 }, S, { ...S, rounds: 2 }).round).toBe(2)
  })
})

describe('Gespeicherter Zustand', () => {
  it('übernimmt einen gültigen Zustand', () => {
    const t = { mode: 'pomodoro', phase: 'shortBreak', round: 3, endsAt: NOW, remaining: 2 * MIN }
    expect(parseState(t, S)).toEqual(t)
  })

  it('beginnt bei Unsinn von vorn', () => {
    expect(parseState('kaputt', S)).toEqual(initialState('pomodoro', S))
    expect(parseState({ mode: 'countdown', phase: 'focus' }, S)).toEqual(initialState('countdown', S))
    expect(parseState({ mode: 'pomodoro', phase: 'focus', round: 9, remaining: 99 * MIN }, S)).toMatchObject({
      round: 4,
      remaining: 25 * MIN,
      endsAt: null,
    })
  })
})

describe('Anzeige', () => {
  it('Uhrzeit mit aufgerundeten Sekunden, ab einer Stunde mit Stunden', () => {
    expect(formatClock(25 * MIN)).toBe('25:00')
    expect(formatClock(5 * MIN - 1)).toBe('05:00')
    expect(formatClock(59_001)).toBe('01:00')
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(65 * MIN)).toBe('1:05:00')
  })

  it('Meldungen am Ende einer Phase', () => {
    const t = initialState('pomodoro', S)
    expect(endMessage('focus', { ...t, phase: 'shortBreak' }, S)).toEqual({
      title: 'Fokus-Runde geschafft',
      body: 'Zeit für eine kurze Pause (5 min).',
    })
    expect(endMessage('focus', { ...t, phase: 'longBreak' }, S).body).toBe('Zeit für eine lange Pause (15 min).')
    expect(endMessage('shortBreak', { ...t, round: 2 }, S)).toEqual({
      title: 'Pause vorbei',
      body: 'Weiter geht’s mit Runde 2 von 4.',
    })
    expect(endMessage('countdown', initialState('countdown', S), S).title).toBe('Zeit ist um')
  })
})
