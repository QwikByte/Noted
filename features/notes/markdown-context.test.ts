import { describe, expect, it } from 'vitest'
import { isProseAt } from './markdown-context'

describe('Fließtext im Markdown', () => {
  const doc = '---\ntitel: x\n---\nText `code` und $a+b$ hier\n```\n\nim Block\n```\n$$\nx^2\n$$\nEnde'
  const at = (needle: string, offset = 0) => doc.indexOf(needle) + offset

  it('erkennt Properties, Code und Formeln – auch leere Zeilen im Code-Block', () => {
    expect(isProseAt(doc, at('titel'))).toBe(false)
    expect(isProseAt(doc, at('code', 1))).toBe(false)
    expect(isProseAt(doc, at('a+b', 1))).toBe(false)
    expect(isProseAt(doc, at('```\n\n', 4))).toBe(false)
    expect(isProseAt(doc, at('im Block'))).toBe(false)
    expect(isProseAt(doc, at('x^2'))).toBe(false)
  })

  it('Fließtext davor, dazwischen und danach', () => {
    expect(isProseAt(doc, at('Text'))).toBe(true)
    expect(isProseAt(doc, at(' und', 1))).toBe(true)
    expect(isProseAt(doc, at('hier'))).toBe(true)
    expect(isProseAt(doc, at('Ende'))).toBe(true)
    expect(isProseAt(doc, doc.length)).toBe(true)
    expect(isProseAt('', 0)).toBe(true)
  })
})
