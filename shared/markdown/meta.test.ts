import { describe, expect, it } from 'vitest'
import {
  extractLinks,
  extractTags,
  findWikiLinks,
  makeExcerpt,
  splitFrontmatter,
  stripCode,
} from './meta'

describe('Frontmatter', () => {
  it('erkennt YAML-Properties nur am Anfang', () => {
    const fm = splitFrontmatter('---\ntags: [a, b]\nkurs: Mathe\n---\nInhalt')
    expect(fm?.data).toEqual({ tags: ['a', 'b'], kurs: 'Mathe' })
    expect(fm?.body).toBe('Inhalt')
    expect(splitFrontmatter('Text\n---\na: 1\n---')).toBeNull()
  })

  it('kommt mit leerem und kaputtem YAML zurecht', () => {
    expect(splitFrontmatter('---\n---\nText')?.body).toBe('Text')
    expect(splitFrontmatter('---\n: : :\n---\nText')?.data).toBeNull()
  })
})

describe('Tags', () => {
  it('liest Tags aus Properties (Liste und Text) und aus dem Text', () => {
    const content = '---\ntags:\n  - Uni\n  - "#mathe"\n---\nHeute #Analysis/Folgen und #todo.'
    expect(extractTags(content)).toEqual(['analysis/folgen', 'mathe', 'todo', 'uni'])
    expect(extractTags('---\ntags: a, b\n---\n')).toEqual(['a', 'b'])
  })

  it('ignoriert Überschriften, Zahlen, Code, Links und Kommentare', () => {
    const content = [
      '# Überschrift',
      'Issue #123 und Farbe #fff',
      '`#nichtimcode`',
      '```',
      '#auchnicht',
      '```',
      '[Link](#anker) https://example.com/#hash',
      '%% #kommentar %%',
      'Aber #ja',
    ].join('\n')
    expect(extractTags(content)).toEqual(['fff', 'ja'])
  })
})

describe('Wikilinks', () => {
  it('erkennt Ziele, Aliase, Überschriften und Einbettungen', () => {
    const links = findWikiLinks('[[Note A|Alias]] [[Ordner/Note B#Abschnitt]] ![[bild.png|300]] ![[Note C]]')
    expect(links).toEqual([
      { embed: false, target: 'Note A', heading: null, alias: 'Alias' },
      { embed: false, target: 'Ordner/Note B', heading: 'Abschnitt', alias: null },
      { embed: true, target: 'bild.png', heading: null, alias: '300' },
      { embed: true, target: 'Note C', heading: null, alias: null },
    ])
  })

  it('liefert normalisierte Notiz-Links ohne Dateien', () => {
    expect(extractLinks('[[Note A]] [[ordner/Note B.md]] ![[bild.png]] `[[code]]` [[note a|x]]')).toEqual([
      'note a',
      'note b',
    ])
  })
})

describe('Hilfsfunktionen', () => {
  it('entfernt Code-Blöcke ohne Zeilen zu verschieben', () => {
    const text = 'a\n```js\nconst x = 1\n```\nb'
    expect(stripCode(text).split('\n')).toHaveLength(5)
    expect(stripCode(text)).not.toContain('const')
  })

  it('erstellt Textauszüge ohne Markdown', () => {
    expect(makeExcerpt('---\na: 1\n---\n## Titel\n- **fett** und [[Link|Alias]]\n> [!note] Hinweis')).toBe(
      'Titel fett und Alias Hinweis',
    )
  })
})

describe('Laufzeit bei böswilligen Eingaben', () => {
  it('verarbeitet 2 MB große Notizen in linearer Zeit', () => {
    for (const s of ['\n'.repeat(2_000_000), '[['.repeat(1_000_000), '[('.repeat(1_000_000), '```\n'.repeat(500_000)]) {
      const t = Date.now()
      extractTags(s)
      extractLinks(s)
      makeExcerpt(s)
      expect(Date.now() - t).toBeLessThan(3000)
    }
  })
})
