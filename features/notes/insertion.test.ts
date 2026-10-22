import { describe, expect, it } from 'vitest'
import { insertionToMarkdown } from './client/active-editor'
import { insertionToHtml } from './rich-html'

const quotes = [
  { text: 'Energie bleibt erhalten', ref: { file: 'Skript.pdf', page: 1 } },
  { text: 'Entropie <wächst>\nzweite Zeile', ref: { file: 'Skript.pdf', page: 12 } },
]

describe('Einfügen aus dem PDF-Viewer', () => {
  it('schreibt mehrere Zitate als eigene Blöcke mit Seitenlink (Markdown)', () => {
    expect(insertionToMarkdown({ kind: 'quotes', quotes })).toBe(
      [
        '> Energie bleibt erhalten',
        '> [[Skript.pdf#page=1|S. 1]]',
        '',
        '> Entropie <wächst>',
        '> zweite Zeile',
        '> [[Skript.pdf#page=12|S. 12]]',
      ].join('\n'),
    )
    expect(insertionToMarkdown({ kind: 'quote', ...quotes[0] })).toBe('> Energie bleibt erhalten\n> [[Skript.pdf#page=1|S. 1]]')
  })

  it('schreibt mehrere Zitate als HTML-Blockzitate (formatierter Text)', () => {
    expect(insertionToHtml({ kind: 'quotes', quotes })).toBe(
      '<blockquote><p>Energie bleibt erhalten<br><a href="/api/files/Skript.pdf#page=1">S. 1</a></p></blockquote>' +
        '<blockquote><p>Entropie &lt;wächst&gt;<br>zweite Zeile<br><a href="/api/files/Skript.pdf#page=12">S. 12</a></p></blockquote>',
    )
  })

  it('übernimmt Text vom Schmierzettel unverändert (Markdown) und als Absätze (formatierter Text)', () => {
    const text = 'Raum 3.14 statt 2.01\nab 10 Uhr\n\n<b>Tel.</b> 0123 & 456'
    expect(insertionToMarkdown({ kind: 'text', text })).toBe(text)
    expect(insertionToHtml({ kind: 'text', text })).toBe(
      '<p>Raum 3.14 statt 2.01<br>ab 10 Uhr</p><p>&lt;b&gt;Tel.&lt;/b&gt; 0123 &amp; 456</p>',
    )
    expect(insertionToHtml({ kind: 'text', text: 'eins\n \n\n\nzwei' })).toBe('<p>eins</p><p>zwei</p>')
  })
})
