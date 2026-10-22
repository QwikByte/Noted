import { describe, expect, it } from 'vitest'
import { validateName } from '@/shared/lib/names'
import { appendText, mergeScratchpad, scratchpadNoteTitle } from './scratchpad'

describe('Schmierzettel: Text anhängen', () => {
  it('trennt mit einer Leerzeile und lässt leere Teile weg', () => {
    expect(appendText('Alt', 'Neu')).toBe('Alt\n\nNeu')
    expect(appendText('Alt\n\n\n', '\n  Neu')).toBe('Alt\n\nNeu')
    expect(appendText('', 'Neu')).toBe('Neu')
    expect(appendText('Alt', '')).toBe('Alt')
    expect(appendText('Alt', ' \n\t')).toBe('Alt')
  })
})

describe('Schmierzettel: zwei Geräte zusammenführen', () => {
  it('übernimmt die Seite, die als einzige geändert hat', () => {
    expect(mergeScratchpad('a', 'a b', 'a b')).toBe('a b')
    expect(mergeScratchpad('a', 'a', 'a vom Handy')).toBe('a vom Handy')
    expect(mergeScratchpad('a', 'a vom Laptop', 'a')).toBe('a vom Laptop')
  })

  it('setzt bei beidseitigem Anhängen den Serverstand vor das hier Angehängte', () => {
    const base = 'Einkauf'
    expect(mergeScratchpad(base, 'Einkauf\nMilch', 'Einkauf\nRaum 3.14')).toBe('Einkauf\nRaum 3.14\n\nMilch')
    // Ohne Grundlage (beide Geräte haben zum ersten Mal geschrieben)
    expect(mergeScratchpad('', 'Laptop', 'Handy')).toBe('Handy\n\nLaptop')
  })

  it('behält bei anderen Änderungen beide Texte vollständig', () => {
    const merged = mergeScratchpad('Tel. 0123', 'Tel. 0123 456 (Laptop)', 'Telefon: 0123 789')
    expect(merged).toBe('Telefon: 0123 789\n\nTel. 0123 456 (Laptop)')
    // Auf einer Seite gekürzt, auf der anderen ergänzt: nichts geht verloren
    const both = mergeScratchpad('eins\nzwei', 'eins', 'eins\nzwei\ndrei')
    expect(both).toContain('eins\nzwei\ndrei')
    expect(both.endsWith('eins')).toBe(true)
  })
})

describe('Schmierzettel: Titel einer neuen Notiz', () => {
  it('nimmt die erste nicht leere Zeile ohne Markdown-Zeichen', () => {
    expect(scratchpadNoteTitle('\n\n  Raum 3.14 statt 2.01\nDetails')).toBe('Raum 3.14 statt 2.01')
    expect(scratchpadNoteTitle('# Idee: Mensa')).toBe('Idee- Mensa')
    expect(scratchpadNoteTitle('- [ ] Aufgabe')).toBe('Aufgabe')
    expect(scratchpadNoteTitle('[[Analysis|Ana]] wiederholen')).toBe('Ana wiederholen')
  })

  it('kürzt lange Zeilen und weicht ohne Buchstaben auf „Schmierzettel“ aus', () => {
    const long = scratchpadNoteTitle('Ein sehr langer Gedanke, der weit über sechzig Zeichen hinausgeht und weiter')
    expect(long.length).toBeLessThanOrEqual(60)
    expect(long.endsWith('…')).toBe(true)
    expect(scratchpadNoteTitle('  \n\t ')).toBe('Schmierzettel')
    expect(scratchpadNoteTitle('###')).toBe('Schmierzettel')
    expect(scratchpadNoteTitle('---\n')).toBe('Schmierzettel')
  })

  it('liefert immer einen gültigen Namen', () => {
    for (const text of ['# Idee: Mensa', 'a/b\\c*?"<>|^', '...Punkt...', 'CON', '  \n', '[[x#y]]', 'x'.repeat(500)]) {
      expect(validateName(scratchpadNoteTitle(text)), text).toBeNull()
    }
  })
})
