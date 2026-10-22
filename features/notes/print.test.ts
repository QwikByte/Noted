import { describe, expect, it } from 'vitest'
import { noteMarkdownForPrint } from './print'

describe('Notiz drucken', () => {
  const md = '---\ntags: [mathe]\n---\n# Analysis\n\nText'

  it('druckt Markdown mit oder ohne Properties', () => {
    expect(noteMarkdownForPrint('markdown', md, { properties: true })).toEqual({ markdown: md, hasProperties: true })
    expect(noteMarkdownForPrint('markdown', md, { properties: false })).toEqual({
      markdown: '# Analysis\n\nText',
      hasProperties: true,
    })
    expect(noteMarkdownForPrint('markdown', '# Nur Text', { properties: true })).toEqual({
      markdown: '# Nur Text',
      hasProperties: false,
    })
  })

  it('druckt Mindmaps als Gliederung ohne das Kennzeichen des Plugins', () => {
    const plain = '---\nmindmap-plugin: basic\n---\n\n# Thema\n\n## Ast\n- Punkt'
    const result = noteMarkdownForPrint('mindmap', plain, { properties: true })
    expect(result.markdown).not.toContain('mindmap-plugin')
    expect(result.markdown).toContain('## Ast')
    expect(result.hasProperties).toBe(false)
    const withTags = '---\nmindmap-plugin: basic\ntags: [bio]\n---\n\n# Zelle'
    const tagged = noteMarkdownForPrint('mindmap', withTags, { properties: false })
    expect(tagged.markdown?.trim()).toBe('# Zelle')
    expect(tagged.hasProperties).toBe(true)
  })

  it('druckt ein Canvas als Text der Karten in Lesereihenfolge', () => {
    const card = (id: string, text: string, y: number) => ({ id, type: 'text', text, x: 0, y, width: 200, height: 80 })
    const canvas = JSON.stringify({ nodes: [card('b', 'Unten', 300), card('a', 'Oben', 0)], edges: [] })
    expect(noteMarkdownForPrint('canvas', canvas, { properties: false })).toEqual({
      markdown: 'Oben\n\nUnten',
      hasProperties: false,
    })
  })

  it('gibt für formatierten und einfachen Text kein Markdown', () => {
    expect(noteMarkdownForPrint('richtext', '<p>Hallo</p>', { properties: true }).markdown).toBeNull()
    expect(noteMarkdownForPrint('text', 'Hallo', { properties: true }).markdown).toBeNull()
  })
})
