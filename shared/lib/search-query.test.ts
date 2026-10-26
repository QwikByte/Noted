import { describe, expect, it } from 'vitest'
import { highlightTerms, parseSearch, positiveQuery } from './search-query'

const empty = { terms: [], phrases: [], excluded: [], tags: [], excludedTags: [] }

describe('Suchanfrage zerlegen', () => {
  it('trennt Wörter und #tags', () => {
    expect(parseSearch('  Licht  wellen #Physik/Optik ')).toEqual({
      ...empty,
      terms: ['Licht', 'wellen'],
      tags: ['physik/optik'],
    })
    expect(parseSearch('#')).toEqual(empty)
  })

  it('erkennt Phrasen – auch ohne schließendes Anführungszeichen', () => {
    expect(parseSearch('"Satz von  Bayes" beweis')).toEqual({ ...empty, terms: ['beweis'], phrases: ['Satz von Bayes'] })
    expect(parseSearch('ableitung "Kettenregel für')).toEqual({ ...empty, terms: ['ableitung'], phrases: ['Kettenregel für'] })
    // Ein einzelnes Wort in Anführungszeichen ist einfach ein Wort
    expect(parseSearch('"Bayes"').terms).toEqual(['Bayes'])
    expect(parseSearch('"')).toEqual(empty)
  })

  it('schließt Wörter, Phrasen und Tags mit „-“ aus – ein einzelnes „-“ und eins im Wort bleiben Text', () => {
    expect(parseSearch('ableitung -physik -"lineare algebra" -#mathe/alt')).toEqual({
      ...empty,
      terms: ['ableitung'],
      excluded: ['physik', 'lineare algebra'],
      excludedTags: ['mathe/alt'],
    })
    expect(parseSearch('E-Mail - Versand').terms).toEqual(['E-Mail', 'Versand'])
    expect(parseSearch('-').excluded).toEqual([])
  })

  it('lässt Teile ohne Buchstaben und Ziffern weg, statt FTS-Syntax daraus zu machen', () => {
    expect(parseSearch('* ( NEAR( "a" OR b')).toEqual({ ...empty, terms: ['NEAR(', 'a', 'OR', 'b'] })
  })

  it('entfernt Steuerzeichen und nimmt höchstens 12 Teile – eine Phrase zählt als einer', () => {
    expect(parseSearch('a\u0001b \u0002').terms).toEqual(['ab'])
    expect(parseSearch('a\tb\nc').terms).toEqual(['a', 'b', 'c'])
    expect(parseSearch(Array.from({ length: 20 }, (_, i) => `w${i}`).join(' ')).terms).toHaveLength(12)
    const parsed = parseSearch(`"eins zwei drei" ${Array.from({ length: 12 }, (_, i) => `w${i}`).join(' ')}`)
    expect(parsed.phrases).toEqual(['eins zwei drei'])
    expect(parsed.terms).toHaveLength(11)
  })

  it('liefert Wörter und Phrasen zum Hervorheben und für Links auf die Fundstelle', () => {
    expect(highlightTerms('taylor "satz von bayes" -physik #mathe')).toEqual(['taylor', 'satz von bayes'])
    expect(positiveQuery('taylor "satz von bayes" -physik #mathe')).toBe('taylor "satz von bayes"')
    expect(highlightTerms(positiveQuery('taylor "satz von bayes"'))).toEqual(['taylor', 'satz von bayes'])
  })
})
