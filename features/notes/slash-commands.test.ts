import { describe, expect, it } from 'vitest'
import { SLASH_COMMANDS, filterSlashCommands, markdownSlashAt, matchSlash } from './slash-commands'

/** Cursor am Ende bzw. an der Stelle von „‸“ */
function at(doc: string) {
  const pos = doc.includes('‸') ? doc.indexOf('‸') : doc.length
  return markdownSlashAt(doc.replace('‸', ''), pos)
}

const ids = (list: { id: string }[]) => list.map((c) => c.id)

describe('Befehle mit „/“', () => {
  it('löst am Zeilenanfang und nach Leerraum aus', () => {
    expect(matchSlash('/')).toEqual({ offset: 0, query: '' })
    expect(matchSlash('Text /ta')).toEqual({ offset: 5, query: 'ta' })
    expect(matchSlash('- /h')).toEqual({ offset: 2, query: 'h' })
    expect(matchSlash('> /')).toEqual({ offset: 2, query: '' })
    expect(matchSlash('/Überschrift')).toEqual({ offset: 0, query: 'Überschrift' })
  })

  it('löst bei Brüchen, Daten, Adressen und Pfaden nicht aus', () => {
    for (const text of ['a/b', 'und/oder', '1/2', '12/10/2026', 'http://', 'https://x.de/a', '~/', '/usr/', '/ab cd']) {
      expect(matchSlash(text), text).toBeNull()
    }
    expect(matchSlash('/' + 'a'.repeat(20))).not.toBeNull()
    expect(matchSlash('/' + 'a'.repeat(21))).toBeNull()
  })

  it('öffnet in Markdown kein Menü in Properties, Code, Formeln, Kommentaren, Links und Tabellen', () => {
    expect(at('---\ntags: /‸\n---\nText')).toBeNull()
    expect(at('```\n/x\n```')).toBeNull()
    expect(at('Text\n```js\nconst a = 1\n/')).toBeNull()
    expect(at('Vorher `Code /x‸` danach')).toBeNull()
    expect(at('Formel $a /b‸$')).toBeNull()
    expect(at('$$\n/‸\n$$')).toBeNull()
    expect(at('%% /x‸ %%')).toBeNull()
    expect(at('Siehe [[Ordner /')).toBeNull()
    expect(at('| Spalte | /')).toBeNull()
  })

  it('öffnet in Markdown nach geschlossenem Code-Block und nach einer Formel', () => {
    expect(at('```\ncode\n```\n/ta')).toEqual({ from: 13, query: 'ta' })
    expect(at('Formel $x$ /')).toEqual({ from: 11, query: '' })
    expect(at('---\ntitel: x\n---\n/h')).toEqual({ from: 17, query: 'h' })
    expect(at('Siehe [[Notiz]] /')).toEqual({ from: 16, query: '' })
  })

  it('listet bei leerem Filter alle Befehle in fester Reihenfolge', () => {
    expect(ids(filterSlashCommands('', { richText: false }))).toEqual(SLASH_COMMANDS.map((c) => c.id))
    expect(SLASH_COMMANDS).toHaveLength(18)
    const rich = ids(filterSlashCommands('', { richText: true }))
    expect(rich).toHaveLength(13)
    for (const id of ['callout', 'math', 'mathBlock', 'mermaid', 'wikilink']) expect(rich).not.toContain(id)
  })

  it('filtert über Namen und Stichwörter – nur zusammenhängend', () => {
    expect(ids(filterSlashCommands('tab', { richText: false }))[0]).toBe('table')
    expect(ids(filterSlashCommands('h2', { richText: false }))[0]).toBe('h2')
    expect(ids(filterSlashCommands('über', { richText: false }))).toEqual(['h1', 'h2', 'h3'])
    expect(ids(filterSlashCommands('ueber', { richText: true }))).toEqual(['h1', 'h2', 'h3'])
    expect(ids(filterSlashCommands('formel', { richText: false }))).toEqual(['math', 'mathBlock'])
    expect(filterSlashCommands('bin', { richText: false })).toEqual([])
    expect(ids(filterSlashCommands('tab', { richText: true, inTable: true }))).not.toContain('table')
  })
})
