import { describe, expect, it } from 'vitest'
import { linkAt, linkAtPos } from './editor-links'

describe('Links im Editor erkennen', () => {
  it('Wikilinks mit Alias und Abschnitt, Einbettungen und PDF-Seiten', () => {
    const line = 'Siehe [[Analysis#Grenzwerte|Grenzwert]] und ![[Skript.pdf#page=3]] sowie [[Bild.png]]'
    expect(linkAt(line, 8)).toEqual({ kind: 'note', target: 'Analysis', heading: 'Grenzwerte' })
    expect(linkAt(line, 50)).toEqual({ kind: 'file', target: 'Skript.pdf', page: 3 })
    expect(linkAt(line, line.length - 3)).toEqual({ kind: 'file', target: 'Bild.png', page: null })
    expect(linkAt('[[#Abschnitt]]', 3)).toEqual({ kind: 'note', target: '', heading: 'Abschnitt' })
  })

  it('zählt die Klammern mit, aber nichts davor oder dahinter', () => {
    const line = 'a [[Notiz]] b'
    expect(linkAt(line, 1)).toBeNull()
    expect(linkAt(line, 2)).toMatchObject({ target: 'Notiz' })
    expect(linkAt(line, 11)).toMatchObject({ target: 'Notiz' })
    expect(linkAt(line, 12)).toBeNull()
  })

  it('mehrere Links in einer Zeile', () => {
    const line = '[[Eins]] [[Zwei]]'
    expect(linkAt(line, 3)).toMatchObject({ target: 'Eins' })
    expect(linkAt(line, 12)).toMatchObject({ target: 'Zwei' })
  })

  it('#Tags nur am Zeilenanfang und nach Leerraum, nicht nur aus Ziffern', () => {
    expect(linkAt('#klausur morgen', 2)).toEqual({ kind: 'tag', tag: 'klausur' })
    expect(linkAt('Thema #Uni/Mathe/ heute', 9)).toEqual({ kind: 'tag', tag: 'uni/mathe' })
    expect(linkAt('a#b', 2)).toBeNull()
    expect(linkAt('Seite #123', 8)).toBeNull()
  })

  it('Markdown-Links und nackte Adressen', () => {
    expect(linkAt('[Moodle](https://moodle.example.org/kurs) dazu', 3)).toEqual({ kind: 'url', href: 'https://moodle.example.org/kurs' })
    expect(linkAt('Quelle: https://de.wikipedia.org/wiki/Welle.', 12)).toEqual({
      kind: 'url',
      href: 'https://de.wikipedia.org/wiki/Welle',
    })
  })

  it('ignoriert Code, Formeln und Properties', () => {
    const doc = '---\ntags: [[x]]\n---\nText `[[Code]]` und $[[a]]$ und [[Echt]]\n```\n[[Block]]\n```\n$$\n[[Formel]]\n$$\n'
    const at = (needle: string) => doc.indexOf(needle) + 2
    expect(linkAtPos(doc, at('[[x]]'))).toBeNull()
    expect(linkAtPos(doc, at('[[Code]]'))).toBeNull()
    expect(linkAtPos(doc, at('[[a]]'))).toBeNull()
    expect(linkAtPos(doc, at('[[Block]]'))).toBeNull()
    expect(linkAtPos(doc, at('[[Formel]]'))).toBeNull()
    expect(linkAtPos(doc, at('[[Echt]]'))).toEqual({ kind: 'note', target: 'Echt', heading: null })
  })
})
