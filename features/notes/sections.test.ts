import { describe, expect, it } from 'vitest'
import { noteSection } from './sections'

const NOTE = [
  '---',
  'tags: [analysis]',
  '---',
  '# Vorlesung 3',
  'Einleitung',
  '',
  '## Grenzwert',
  'Eine Folge konvergiert gegen a, wenn …',
  '',
  '### Beispiel',
  '1/n → 0',
  '',
  '```',
  '## Kein Abschnitt (Code)',
  '```',
  '',
  '## Stetigkeit',
  'f ist stetig, wenn …',
  '',
  'Ableitung',
  '---------',
  'Der Grenzwert des Differenzenquotienten',
].join('\n')

describe('noteSection', () => {
  it('nimmt den Abschnitt bis zur nächsten Überschrift gleicher Ebene – samt Unterabschnitten', () => {
    expect(noteSection(NOTE, 'Grenzwert')).toBe(
      ['## Grenzwert', 'Eine Folge konvergiert gegen a, wenn …', '', '### Beispiel', '1/n → 0', '', '```', '## Kein Abschnitt (Code)', '```'].join('\n'),
    )
    expect(noteSection(NOTE, 'Beispiel')).toBe(['### Beispiel', '1/n → 0', '', '```', '## Kein Abschnitt (Code)', '```'].join('\n'))
  })

  it('der letzte Abschnitt reicht bis zum Ende, Setext-Überschriften zählen mit', () => {
    expect(noteSection(NOTE, 'Stetigkeit')).toBe(['## Stetigkeit', 'f ist stetig, wenn …'].join('\n'))
    expect(noteSection(NOTE, 'ableitung')).toBe(['Ableitung', '---------', 'Der Grenzwert des Differenzenquotienten'].join('\n'))
    // Eine Überschrift der obersten Ebene umfasst alles darunter
    expect(noteSection(NOTE, 'Vorlesung 3')?.split('\n')).toHaveLength(NOTE.split('\n').length - 3)
  })

  it('ohne Überschrift die ganze Notiz ohne Frontmatter, unbekannte Überschriften ergeben null', () => {
    expect(noteSection(NOTE, null)?.startsWith('# Vorlesung 3')).toBe(true)
    expect(noteSection('Nur Text\r\nzweite Zeile', '')).toBe('Nur Text\nzweite Zeile')
    expect(noteSection(NOTE, 'Kein Abschnitt (Code)')).toBeNull()
    expect(noteSection(NOTE, 'Gibt es nicht')).toBeNull()
  })
})
