import { describe, expect, it } from 'vitest'
import { findMatches } from './search-match'

const words = (text: string, terms: string[]) => findMatches(text, terms).map((m) => text.slice(m.from, m.to))

describe('Fundstellen der Volltextsuche', () => {
  it('findet Wortanfänge ohne Rücksicht auf Groß-/Kleinschreibung', () => {
    expect(words('Die Taylorreihe und taylor-Polynome', ['taylor'])).toEqual(['Taylor', 'taylor'])
    expect(words('Satz von Bayes', ['BAY'])).toEqual(['Bay'])
  })

  it('ignoriert Umlaute und Akzente wie FTS5 – die Stellen passen zum Original', () => {
    const text = 'Übungen zur Fréchet-Ableitung und Straße'
    expect(words(text, ['ubung'])).toEqual(['Übung'])
    expect(words(text, ['frechet'])).toEqual(['Fréchet'])
    expect(words(text, ['straß'])).toEqual(['Straß'])
    // Zerlegte Umlaute (U + Trema) zählen genauso
    const nfd = 'Übung'
    expect(findMatches(nfd, ['übung'])).toEqual([{ from: 0, to: nfd.length }])
  })

  it('findet nichts mitten im Wort und nimmt mehrere Begriffe', () => {
    expect(words('Mittelwertsatz', ['satz'])).toEqual([])
    expect(words('Satz von Rolle: Mittelwertsatz', ['satz', 'rolle'])).toEqual(['Satz', 'Rolle'])
  })

  it('fasst überlappende Treffer zusammen und sortiert sie', () => {
    expect(findMatches('Analysis', ['ana', 'analy'])).toEqual([{ from: 0, to: 5 }])
    expect(findMatches('b a', ['a', 'b'])).toEqual([
      { from: 0, to: 1 },
      { from: 2, to: 3 },
    ])
  })

  it('kommt mit Sonderzeichen, Emoji und leeren Eingaben zurecht', () => {
    expect(words('Formel (a+b)² 😀 Ende', ['ende'])).toEqual(['Ende'])
    expect(words('E-Mail an alle', ['e-mail'])).toEqual(['E-Mail'])
    expect(findMatches('', ['a'])).toEqual([])
    expect(findMatches('Text', [])).toEqual([])
    expect(findMatches('Text', ['"', '*'])).toEqual([])
  })

  it('liefert höchstens 500 Treffer, auch in großen Texten schnell', () => {
    const text = 'wort '.repeat(200_000)
    const t = Date.now()
    expect(findMatches(text, ['wort'])).toHaveLength(500)
    expect(Date.now() - t).toBeLessThan(3000)
  })
})
