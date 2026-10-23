import { describe, expect, it } from 'vitest'
import { insertAt } from './card-editor'

describe('Datei in den Karteneditor einfügen', () => {
  it('setzt an Anfang, Mitte und Ende ein und den Cursor dahinter', () => {
    expect(insertAt('Frage', { start: 0, end: 0 }, '![[a.png]]')).toEqual({ text: '![[a.png]]Frage', cursor: 10 })
    expect(insertAt('Frage Antwort', { start: 6, end: 6 }, 'X')).toEqual({ text: 'Frage XAntwort', cursor: 7 })
    expect(insertAt('Frage', { start: 5, end: 5 }, ' ![[a.png]]')).toEqual({ text: 'Frage ![[a.png]]', cursor: 16 })
  })

  it('ersetzt eine Markierung und kommt mit Positionen außerhalb des Textes zurecht', () => {
    expect(insertAt('Bild hier einfügen', { start: 5, end: 9 }, '![[b.png]]')).toEqual({ text: 'Bild ![[b.png]] einfügen', cursor: 15 })
    // Text wurde während des Hochladens gekürzt
    expect(insertAt('kurz', { start: 10, end: 12 }, 'X')).toEqual({ text: 'kurzX', cursor: 5 })
  })
})
