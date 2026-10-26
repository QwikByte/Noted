import { describe, expect, it } from 'vitest'
import { isLanguageTag, noteLanguage, withLanguage } from './language'

describe('Sprache einer Notiz', () => {
  it('liest lang aus dem Frontmatter von Markdown und Mindmaps', () => {
    expect(noteLanguage('markdown', '---\nlang: en\n---\nText', 'de')).toBe('en')
    expect(noteLanguage('markdown', '---\ntitle: X\nlang: en-GB\n---\n', 'de')).toBe('en-GB')
    expect(noteLanguage('mindmap', '---\nlang: fr\n---\n# Thème', 'de')).toBe('fr')
  })

  it('nimmt sonst die Standardsprache', () => {
    expect(noteLanguage('markdown', 'Kein Frontmatter\nlang: en', 'de')).toBe('de')
    expect(noteLanguage('markdown', '---\ntags: [a]\n---\nText', 'it')).toBe('it')
    expect(noteLanguage('markdown', '', 'de')).toBe('de')
  })

  it('ignoriert ungültige Werte', () => {
    for (const value of ['42', '[en]', 'english language', 'e', '"en_GB"', '']) {
      expect(noteLanguage('markdown', `---\nlang: ${value}\n---\n`, 'de')).toBe('de')
    }
    expect(noteLanguage('markdown', '---\nlang: [\n---\n', 'de')).toBe('de')
  })

  it('hat bei Formaten ohne Frontmatter immer die Standardsprache', () => {
    expect(noteLanguage('richtext', '---\nlang: en\n---\n<p>Text</p>', 'de')).toBe('de')
    expect(noteLanguage('text', '---\nlang: en\n---\n', 'es')).toBe('es')
  })

  it('erkennt Sprachkürzel', () => {
    expect(['de', 'en-GB', 'zh-Hant-TW', 'pt-BR', 'gsw'].every(isLanguageTag)).toBe(true)
    expect(['', 'deutsch', 'en_GB', 'en-', '1de'].some(isLanguageTag)).toBe(false)
  })
})

describe('lang ins Frontmatter schreiben', () => {
  it('legt ein Frontmatter an, wenn es keins gibt', () => {
    expect(withLanguage('# Titel', 'en')).toBe('---\nlang: en\n---\n# Titel')
    expect(withLanguage('# Titel', null)).toBe('# Titel')
  })

  it('ergänzt oder ersetzt nur die Zeile mit lang', () => {
    const fm = '---\ntags: [a, b] # Kommentar\nkurs: Mathe\n---\nText'
    expect(withLanguage(fm, 'en')).toBe('---\ntags: [a, b] # Kommentar\nkurs: Mathe\nlang: en\n---\nText')
    expect(withLanguage('---\nlang: en\nkurs: X\n---\nText', 'fr')).toBe('---\nlang: fr\nkurs: X\n---\nText')
    expect(withLanguage('---\nlang:\n  - en\nkurs: X\n---\nText', 'fr')).toBe('---\nlang: fr\nkurs: X\n---\nText')
  })

  it('entfernt lang und ein dann leeres Frontmatter', () => {
    expect(withLanguage('---\nlang: en\nkurs: X\n---\nText', null)).toBe('---\nkurs: X\n---\nText')
    expect(withLanguage('---\nlang: en\n---\nText', null)).toBe('Text')
    expect(withLanguage('---\nkurs: X\n---\nText', null)).toBe('---\nkurs: X\n---\nText')
  })

  it('ergibt eine Notiz, deren Sprache wieder gelesen wird', () => {
    expect(noteLanguage('markdown', withLanguage('---\ntitle: A\n---\nB', 'en-GB'), 'de')).toBe('en-GB')
  })
})
