import { describe, expect, it } from 'vitest'
import { clozeAnswer, clozeBlanks, clozeCount, clozeQuestion, clozeText, hasCloze, normalizeCloze } from './cloze'

describe('Lückentext', () => {
  const text = 'Die Ableitung von ==sin== ist ==cos==, `a == b` ist Code.'

  it('zählt Lücken – nicht in Inline-Code und nicht leer', () => {
    expect(clozeCount(text)).toBe(2)
    expect(clozeCount('Keine ==== Lücke und `==x==` auch nicht')).toBe(0)
    expect(hasCloze('Hauptstadt: {{Paris}}')).toBe(true)
    expect(hasCloze('Nur Text')).toBe(false)
  })

  it('wandelt {{Lücke}} in ==Lücke== um – nicht in Code und nicht die Platzhalter der Vorlagen', () => {
    expect(normalizeCloze('{{Paris}} liegt an der {{Seine}}, `{{code}}` bleibt')).toBe('==Paris== liegt an der ==Seine==, `{{code}}` bleibt')
    expect(normalizeCloze('# {{title}} am {{date}} um {{ Time }}')).toBe('# {{title}} am {{date}} um {{ Time }}')
    expect(hasCloze('Vorlesung vom {{date}} ({{date:DD.MM.YYYY}})')).toBe(false)
  })

  it('fragt jede Lücke einzeln ab, die anderen bleiben sichtbar', () => {
    expect(clozeQuestion(text, 0)).toBe('Die Ableitung von <span class="cloze-gap">[…]</span> ist cos, `a == b` ist Code.')
    expect(clozeQuestion(text, 1)).toBe('Die Ableitung von sin ist <span class="cloze-gap">[…]</span>, `a == b` ist Code.')
    expect(clozeAnswer(text, 1)).toBe('Die Ableitung von sin ist ==cos==, `a == b` ist Code.')
    expect(clozeText(text, 0)).toBe('sin')
    expect(clozeText(text, 5)).toBe('')
  })

  it('macht für den Druck alle Lücken zu Platzhaltern – Inline-Code bleibt', () => {
    expect(clozeBlanks('Die Ableitung von ==sin== ist ==cos==, `a ==b== c` ist Code.')).toBe(
      'Die Ableitung von <span class="cloze-gap">[…]</span> ist <span class="cloze-gap">[…]</span>, `a ==b== c` ist Code.',
    )
    expect(clozeBlanks('Ohne Lücke')).toBe('Ohne Lücke')
  })
})
