import { describe, expect, it } from 'vitest'
import { formatSteps, parseSteps } from './steps'

describe('Lernschritte eingeben', () => {
  it('liest Minuten, Stunden und Tage wie in Anki – ohne Einheit Minuten', () => {
    expect(parseSteps('1m 10m')).toEqual([1, 10])
    expect(parseSteps(' 10m, 1h;1d ')).toEqual([10, 60, 1440])
    expect(parseSteps('10 60 1440')).toEqual([10, 60, 1440])
    expect(parseSteps('1,5h 0.5d')).toEqual([90, 720])
    expect(parseSteps('30D')).toEqual([43_200])
  })

  it('lehnt leere, unbekannte, zu viele und zu lange Schritte verständlich ab', () => {
    expect(() => parseSteps('  ')).toThrow('Gib mindestens einen Lernschritt an')
    expect(() => parseSteps('10x')).toThrow('„10x“ ist kein Lernschritt')
    expect(() => parseSteps('0m')).toThrow('zwischen 1 Minute und 30 Tagen')
    expect(() => parseSteps('31d')).toThrow('zwischen 1 Minute und 30 Tagen')
    expect(() => parseSteps('1 2 3 4 5 6 7 8 9 10 11')).toThrow('Höchstens 10 Lernschritte')
  })

  it('zeigt Schritte in der größten Einheit, die glatt aufgeht', () => {
    expect(formatSteps([1, 10])).toBe('1m 10m')
    expect(formatSteps([90, 60, 1440, 2880])).toBe('90m 1h 1d 2d')
    expect(parseSteps(formatSteps([5, 120, 4320]))).toEqual([5, 120, 4320])
  })
})
