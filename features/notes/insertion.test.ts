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
})
