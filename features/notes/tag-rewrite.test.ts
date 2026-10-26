import { describe, expect, it } from 'vitest'
import { extractTags } from '@/shared/markdown/meta'
import { htmlToText } from '@/shared/lib/html'
import { serializeCanvas, canvasText } from '@/features/canvas/canvas'
import { renameTagIn } from './tag-rewrite'

describe('Tags im Text umbenennen', () => {
  it('ersetzt den Tag und seine Unter-Tags – nicht ähnliche Tags, nicht in Code und Kommentaren', () => {
    const md = [
      '#mathe am Anfang, #Mathe groß und #mathe/übung',
      '#mathematik bleibt, E-Mail#mathe auch',
      '`#mathe` im Code',
      '```',
      '#mathe im Block',
      '```',
      '%% #mathe im Kommentar %%',
    ].join('\n')
    const out = renameTagIn('markdown', md, 'mathe', 'analysis')
    expect(out.split('\n')[0]).toBe('#analysis am Anfang, #analysis groß und #analysis/übung')
    expect(out.split('\n').slice(1).join('\n')).toBe(md.split('\n').slice(1).join('\n'))
  })

  it('behält die Schreibweise des Rests und nimmt den neuen Namen wie eingegeben', () => {
    expect(renameTagIn('markdown', 'Siehe #Mathe/Analysis', 'mathe', 'Studium')).toBe('Siehe #Studium/Analysis')
  })

  it('ändert im Frontmatter nur die Tags – als Liste, Text oder Block, Kommentare bleiben', () => {
    const md = [
      '---',
      'title: mathe',
      'tags: [mathe, "mathe/alt", analysis] # mathe als Kommentar',
      'tag: mathe, physik',
      'Tags:',
      '  - mathe',
      '  - mathematik',
      'kurs: Mathe',
      '---',
      'Text #mathe',
    ].join('\n')
    const out = renameTagIn('markdown', md, 'mathe', 'analysis')
    expect(out).toBe(
      [
        '---',
        'title: mathe',
        'tags: [analysis, "analysis/alt", analysis] # mathe als Kommentar',
        'tag: analysis, physik',
        'Tags:',
        '  - analysis',
        '  - mathematik',
        'kurs: Mathe',
        '---',
        'Text #analysis',
      ].join('\n'),
    )
    expect(extractTags(out)).toEqual(['analysis', 'analysis/alt', 'mathematik', 'physik'])
  })

  it('formatierter Text: nur Text zwischen den Tags, keine Farbwerte in Attributen und kein Code', () => {
    const html = '<p style="color: #mathe">#mathe und <strong>x</strong>#mathe</p><p>&nbsp;#mathe</p><pre><code>#mathe</code></pre>'
    const out = renameTagIn('richtext', html, 'mathe', 'analysis')
    expect(out).toBe('<p style="color: #mathe">#analysis und <strong>x</strong>#mathe</p><p>&nbsp;#analysis</p><pre><code>#mathe</code></pre>')
    // Dieselben Tags, wie sie beim Speichern gelesen werden
    expect(extractTags(htmlToText(out))).toEqual(['analysis'])
  })

  it('Canvas: Textkarten, Mindmap wie Markdown', () => {
    const canvas = serializeCanvas({
      nodes: [
        { id: 'a', type: 'text', text: 'Karte #mathe', x: 0, y: 0, width: 100, height: 100 },
        { id: 'b', type: 'file', file: 'mathe.pdf', x: 200, y: 0, width: 100, height: 100 },
      ],
      edges: [],
    })
    const out = renameTagIn('canvas', canvas, 'mathe', 'analysis')
    expect(canvasText(out)).toContain('Karte #analysis')
    expect(out).toContain('"file":"mathe.pdf"')
    expect(renameTagIn('mindmap', '# Thema\n- Ast #mathe', 'mathe', 'analysis')).toBe('# Thema\n- Ast #analysis')
  })

  it('lässt Text ohne den Tag Zeichen für Zeichen gleich', () => {
    const md = '---\ntags: [ physik ]\n---\nNichts zu tun #physik'
    expect(renameTagIn('markdown', md, 'mathe', 'analysis')).toBe(md)
  })
})
