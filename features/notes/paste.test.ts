import { describe, expect, it } from 'vitest'
import { cleanPastedMarkdown, isNotedHtml, singleUrl } from './paste'

describe('Einfügen im Editor', () => {
  it('erkennt eine einzelne Adresse – auch mit Leerraum am Rand, nicht in einem Satz', () => {
    expect(singleUrl('  https://moodle.example.org/kurs?id=3\n')).toBe('https://moodle.example.org/kurs?id=3')
    expect(singleUrl('HTTP://example.org')).toBe('HTTP://example.org')
    expect(singleUrl('siehe https://example.org')).toBeNull()
    expect(singleUrl('https://a.org https://b.org')).toBeNull()
    expect(singleUrl('ftp://example.org')).toBeNull()
  })

  it('räumt umgewandeltes Markdown auf', () => {
    expect(cleanPastedMarkdown('\n\n## Titel\n\n\n\n- Punkt eins\n\n')).toBe('## Titel\n\n- Punkt eins')
  })

  it('erkennt HTML aus dem Lesemodus von Noted', () => {
    expect(isNotedHtml('<p><a class="wikilink" href="/?n=1" data-note-id="1">A</a></p>')).toBe(true)
    expect(isNotedHtml('<span class="katex"><span class="katex-mathml">…</span></span>')).toBe(true)
    expect(isNotedHtml('<h2>Titel</h2><ul><li><strong>fett</strong></li></ul>')).toBe(false)
  })
})
