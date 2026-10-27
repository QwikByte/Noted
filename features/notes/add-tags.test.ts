import { describe, expect, it } from 'vitest'
import { extractTags } from '@/shared/markdown/meta'
import { withTags } from './add-tags'

describe('Tags hinzufügen', () => {
  it('schreibt sie bei Markdown in die Properties und behält deren Form', () => {
    expect(withTags('markdown', '# Thermo\nText', ['physik', 'wärme'])).toBe('---\ntags:\n  - physik\n  - wärme\n---\n# Thermo\nText')
    expect(withTags('markdown', '---\ntags: [physik]\nlang: de # Sprache\n---\nText', ['wärme'])).toBe(
      '---\ntags: [ physik, wärme ]\nlang: de # Sprache\n---\nText',
    )
    expect(withTags('mindmap', '---\nmindmap-plugin: basic\ntag: alt neu\n---\n# Karte', ['x'])).toBe(
      '---\nmindmap-plugin: basic\ntag:\n  - alt\n  - neu\n  - x\n---\n# Karte',
    )
  })

  it('liest die neuen Tags danach wie alle anderen', () => {
    const next = withTags('markdown', '---\ntitle: x\n---\nText #alt', ['neu/unter'])
    expect(extractTags(next)).toEqual(['alt', 'neu/unter'])
  })

  it('hängt sie bei kaputten Properties, einfachem und formatiertem Text als #tags an', () => {
    expect(withTags('markdown', '---\n: [kaputt\n---\nText', ['a'])).toBe('---\n: [kaputt\n---\nText\n\n#a\n')
    expect(withTags('text', 'Notiz\n\n', ['a', 'b'])).toBe('Notiz\n\n#a #b\n')
    expect(withTags('text', '', ['a'])).toBe('#a\n')
    expect(withTags('richtext', '<p>Text</p>', ['a<b'])).toBe('<p>Text</p><p>#a&lt;b</p>')
  })

  it('lässt Canvas und leere Listen unverändert', () => {
    expect(withTags('canvas', '{"nodes":[]}', ['a'])).toBe('{"nodes":[]}')
    expect(withTags('markdown', 'Text', [])).toBe('Text')
  })
})
