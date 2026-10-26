import { describe, expect, it } from 'vitest'
import {
  extractLinks,
  extractTags,
  findHeadingLine,
  findHeadings,
  findWikiLinks,
  headingKey,
  linkFolders,
  makeExcerpt,
  markdownPlainText,
  normalizeTag,
  splitFrontmatter,
  stripCode,
  trimTag,
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
      { key: 'note a', path: '' },
      { key: 'note b', path: 'ordner' },
    ])
  })

  it('unterscheidet Links mit Ordnerpfad', () => {
    expect(extractLinks('[[Übung 1]] [[Analysis/Übung 1]] [[ Uni / Analysis /Übung 1#A]] [[/Übung 1]]')).toEqual([
      { key: 'übung 1', path: '' },
      { key: 'übung 1', path: 'analysis' },
      { key: 'übung 1', path: 'uni/analysis' },
    ])
    expect(linkFolders('Uni/Analysis/Übung 1')).toEqual(['uni', 'analysis'])
    expect(linkFolders('Übung 1')).toEqual([])
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

  it('liefert den lesbaren Text ohne Frontmatter, Code, Kommentare und Einbettungen', () => {
    const md = [
      '---',
      'tags: [mathe]',
      '---',
      '## Titel',
      '- **fett** und [Skript](https://example.org/a/b/c)',
      '[[Analysis|Ana]] [[Physik]] [[Physik#Wärme]] [[Kapitel 3.1]]',
      '![[bild.png]] [[skript.pdf]] [[skript.pdf|Skript]] ![[Notiz]]',
      '`inline` %%geheim%%',
      '```js',
      'const x = 1',
      '```',
      '> [!note] Hinweis',
    ].join('\n')
    expect(markdownPlainText(md)).toBe('Titel fett und Skript Ana Physik Physik Wärme Kapitel 3.1 Skript Hinweis')
  })
})

describe('Laufzeit bei böswilligen Eingaben', () => {
  it('kürzt eingegebene Tags in linearer Zeit – auch aus vielen „/“', () => {
    expect(trimTag(' ##Mathe/Analysis// ')).toBe('Mathe/Analysis')
    expect(normalizeTag('#Mathe/')).toBe('mathe')
    const t = Date.now()
    expect(normalizeTag('/'.repeat(200_000) + 'x')).toBe('/'.repeat(200_000) + 'x')
    expect(trimTag('#'.repeat(200_000) + '/'.repeat(200_000))).toBe('')
    expect(Date.now() - t).toBeLessThan(1000)
  })

  it('verarbeitet 2 MB große Notizen in linearer Zeit', () => {
    for (const s of ['\n'.repeat(2_000_000), '[['.repeat(1_000_000), '[('.repeat(1_000_000), '```\n'.repeat(500_000)]) {
      const t = Date.now()
      extractTags(s)
      extractLinks(s)
      makeExcerpt(s)
      markdownPlainText(s)
      findHeadings(s)
      expect(Date.now() - t).toBeLessThan(3000)
    }
  })

  it('findet Überschriften in großen Notizen in linearer Zeit', () => {
    const inputs = [
      'Text\n===\n'.repeat(200_000),
      '# x\n'.repeat(500_000),
      'Absatz\n'.repeat(500_000) + '---',
      '`'.repeat(1_000_000) + '\n# x',
      '# ' + '$'.repeat(1_000_000),
      '# ' + ' # '.repeat(300_000) + 'x',
    ]
    for (const s of inputs) {
      const t = Date.now()
      findHeadings(s)
      expect(Date.now() - t).toBeLessThan(3000)
    }
    expect(findHeadings(inputs[0])).toHaveLength(200_000)
  })
})

describe('Überschriften', () => {
  it('findet die Zeile einer Überschrift – ohne Frontmatter, Code-Blöcke und Formatierung', () => {
    const note = ['---', '# kein: Titel', '---', '```', '## Ziel', '```', 'Text', '## **Ziel**: Grenzwerte ##', '### Ziel'].join('\n')
    expect(findHeadingLine(note, 'Ziel: Grenzwerte')).toBe(7)
    expect(findHeadingLine(note, 'ziel')).toBe(8)
    expect(findHeadingLine(note, 'Fehlt')).toBeNull()
    expect(findHeadingLine(note, '')).toBeNull()
  })

  it('findet Ebenen und Zeilen inklusive Frontmatter – nicht in Code, Kommentaren, Zitaten und Callouts', () => {
    const note = [
      '---',
      'title: x',
      '---',
      '# A',
      '## B',
      '#### C',
      '```',
      '# kein Titel',
      '```',
      '~~~',
      '# auch nicht',
      '~~~',
      '%% ## versteckt',
      '## noch versteckt %%',
      '> ## Im Kasten',
      '> [!note] Hinweis',
      '> # Im Callout',
      '   ### Drei Leerzeichen',
      '    # Vier Leerzeichen',
      '#tag',
      '',
      '<h2>HTML</h2>',
      '---',
      '',
      '##',
      '## ##',
      '```',
      '# offen bis zum Ende',
    ].join('\n')
    expect(findHeadings(note).map((h) => [h.level, h.text, h.line])).toEqual([
      [1, 'A', 3],
      [2, 'B', 4],
      [4, 'C', 5],
      [3, 'Drei Leerzeichen', 17],
    ])
  })

  it('liest schließende # nur nach Leerraum', () => {
    expect(findHeadings('## Einführung in C#\n## Titel ##\n### Mit   #  \n# C##').map((h) => h.raw)).toEqual([
      'Einführung in C#',
      'Titel',
      'Mit',
      'C##',
    ])
  })

  it('erkennt Setext-Überschriften nur nach Leerzeile, Überschrift oder am Anfang', () => {
    const note = [
      'Erster',
      '===',
      'Zweiter über',
      'zwei Zeilen',
      '---',
      '',
      '- Punkt',
      '---',
      '',
      'Absatz',
      '',
      '---',
      '> Zitat',
      'weiter',
      '===',
      '',
      'Absatz',
      '> Zitat',
      '---',
      '# ATX',
      'Danach',
      '-------',
    ].join('\n')
    expect(findHeadings(note).map((h) => [h.level, h.text, h.line])).toEqual([
      [1, 'Erster', 0],
      [2, 'Zweiter über zwei Zeilen', 2],
      [1, 'ATX', 19],
      [2, 'Danach', 20],
    ])
    // Das --- des Frontmatters ist keine Unterstreichung
    expect(findHeadings('---\na: 1\n---\nText')).toEqual([])
  })

  it('zeigt Überschriften als Klartext – Code und Formeln bleiben als Quelltext', () => {
    const note = [
      '## [[Ziel|Alias]] und [[Notiz]]',
      '## [Text](https://example.com) ![[bild.png]]',
      '## **fett** und _kursiv_ ==markiert==',
      '### Fall $n = 1$ und `a*b_c`',
      '## $$x_1 * y$$',
      '## 1. Einleitung',
    ].join('\n')
    expect(findHeadings(note).map((h) => h.text)).toEqual([
      'Alias und Notiz',
      'Text',
      'fett und kursiv markiert',
      'Fall n = 1 und a*b_c',
      'x_1 * y',
      '1. Einleitung',
    ])
    expect(findHeadings(note)[0].raw).toBe('[[Ziel|Alias]] und [[Notiz]]')
  })

  it('lässt sich von einzelnen Backticks nicht stören', () => {
    expect(findHeadings('Das gibt`s nicht\n## Danach\nund noch ein ` hier\n## Ende').map((h) => h.text)).toEqual([
      'Danach',
      'Ende',
    ])
  })

  it('springt per Roh- oder Klartext auch zu Überschriften mit Wikilink und zu Setext-Überschriften', () => {
    const note = 'Text\n\n## Siehe [[Analysis|Folgen]]\n\nGrenzwerte\n---\n'
    expect(findHeadingLine(note, 'Siehe [[Analysis|Folgen]]')).toBe(2)
    expect(findHeadingLine(note, 'Siehe Folgen')).toBe(2)
    expect(findHeadingLine(note, 'Grenzwerte')).toBe(4)
  })

  it('vergleicht Überschriften ohne Formatierung und Satzzeichen', () => {
    expect(headingKey('**Satz** von  $x$!')).toBe(headingKey('Satz von x'))
    expect(headingKey('Übung 1.2')).toBe('übung 1 2')
  })
})
