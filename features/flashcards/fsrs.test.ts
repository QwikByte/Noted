import { describe, expect, it } from 'vitest'
import { fsrsInterval, initialMemory, memoryFromSm2, nextMemory, retrievability } from './fsrs'
import { DAY, MINUTE, previewIntervals, schedule, type Plan, type Rating } from './srs'
import type { SrsState } from './types'

const NOW = new Date('2026-10-14T10:00:00').getTime()
const FSRS: Plan = { kind: 'fsrs', retention: 0.9 }
const days = (state: SrsState, at: number) => Math.round((state.due - at) / DAY)

describe('FSRS-Formeln', () => {
  it('nach S Tagen liegt die Erinnerung bei 90 % – der Abstand passt zur Behaltensrate', () => {
    expect(retrievability(10, 10)).toBeCloseTo(0.9, 6)
    expect(retrievability(0, 10)).toBe(1)
    expect(fsrsInterval(10, 0.9)).toBeCloseTo(10, 6)
    expect(fsrsInterval(10, 0.8)).toBeGreaterThan(fsrsInterval(10, 0.9))
    expect(fsrsInterval(10, 0.95)).toBeLessThan(fsrsInterval(10, 0.9))
  })

  it('beginnt mit den Standardwerten und wird mit guten Bewertungen stabiler, mit „Nochmal“ instabiler', () => {
    expect(initialMemory(3).stability).toBeCloseTo(3.173, 3)
    expect(initialMemory(1).difficulty).toBeGreaterThan(initialMemory(4).difficulty)
    const m = { stability: 10, difficulty: 5 }
    const good = nextMemory(m, 3, 10)
    const hard = nextMemory(m, 2, 10)
    const easy = nextMemory(m, 4, 10)
    const again = nextMemory(m, 1, 10)
    expect(hard.stability).toBeLessThan(good.stability)
    expect(easy.stability).toBeGreaterThan(good.stability)
    expect(again.stability).toBeLessThan(m.stability)
    expect(again.difficulty).toBeGreaterThan(m.difficulty)
    expect(easy.difficulty).toBeLessThan(m.difficulty)
    // Am selben Tag (Lernschritte): Kurzzeitformel, „Gut“ erhöht leicht
    expect(nextMemory(m, 3, 0.01).stability).toBeGreaterThan(m.stability)
  })

  it('rechnet SM-2-Lernstand in Stabilität und Schwierigkeit um', () => {
    expect(memoryFromSm2(30, 2.5)).toEqual({ stability: 30, difficulty: 4 })
    expect(memoryFromSm2(0, 1.3)).toEqual({ stability: 3.173, difficulty: 10 })
  })
})

describe('Wiederholungsplan mit FSRS', () => {
  it('nutzt die Lernschritte und plant dann nach Stabilität', () => {
    const a = schedule(null, 3, NOW, FSRS)
    expect(a).toMatchObject({ phase: 'learning', step: 1, due: NOW + 10 * MINUTE })
    expect(a.stability).toBeGreaterThan(3)
    const b = schedule(a, 3, NOW + 10 * MINUTE, FSRS)
    expect(b.phase).toBe('review')
    expect(b.interval).toBe(Math.round(fsrsInterval(b.stability!, 0.9)))
    expect(days(b, NOW + 10 * MINUTE)).toBe(b.interval)
  })

  it('Schwer < Gut < Einfach, „Nochmal“ führt zum Wiederlernen', () => {
    const learned: SrsState = { ...schedule(null, 4, NOW - 20 * DAY, FSRS) }
    const at = learned.due
    const ivl = (r: Rating) => days(schedule(learned, r, at, FSRS), at)
    expect(ivl(2)).toBeLessThan(ivl(3))
    expect(ivl(3)).toBeLessThan(ivl(4))
    const lapse = schedule(learned, 1, at, FSRS)
    expect(lapse).toMatchObject({ phase: 'relearning', lapses: 1, due: at + 10 * MINUTE })
    expect(lapse.stability).toBeLessThan(learned.stability!)
    const back = schedule(lapse, 3, at + 10 * MINUTE, FSRS)
    expect(back.phase).toBe('review')
  })

  it('höhere Behaltensrate → kürzere Abstände', () => {
    const learned = schedule(null, 4, NOW - 20 * DAY, FSRS)
    const at = learned.due
    const strict = schedule(learned, 3, at, { kind: 'fsrs', retention: 0.97 })
    const relaxed = schedule(learned, 3, at, { kind: 'fsrs', retention: 0.8 })
    expect(strict.interval).toBeLessThan(relaxed.interval)
  })

  it('übernimmt Karten, die bisher mit SM-2 geplant wurden, ohne den Fortschritt zu verlieren', () => {
    const sm2 = schedule(null, 4, NOW - 30 * DAY)
    const due = { ...sm2, interval: 30, due: NOW, reviewedAt: NOW - 30 * DAY }
    expect(due.stability).toBeUndefined()
    const next = schedule(due, 3, NOW, FSRS)
    expect(next.phase).toBe('review')
    expect(next.interval).toBeGreaterThan(30)
    expect(next.stability).toBeGreaterThan(30)
    // Die Knöpfe zeigen die FSRS-Abstände
    expect(previewIntervals(due, NOW, FSRS)[3]).toBe(next.due - NOW)
  })

  it('SM-2 bleibt unverändert und ohne Stabilität', () => {
    const s = schedule(null, 4, NOW)
    expect(s.interval).toBe(4)
    expect(s.stability).toBeUndefined()
  })
})
