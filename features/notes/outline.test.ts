import { describe, expect, it } from 'vitest'
import { MAX_OUTLINE_ENTRIES, currentEntry, hasOutline, noteOutline } from './outline'
import { richTextHeadings } from './rich-html'

const outline = (format: Parameters<typeof noteOutline>[0], content: string) =>
  noteOutline(format, content).entries.map((e) => [e.key, e.depth, e.text])

describe('Gliederung', () => {
  it('gibt es nur für Markdown und formatierten Text', () => {
    expect(hasOutline('markdown')).toBe(true)
    expect(hasOutline('richtext')).toBe(true)
    expect(outline('markdown', '---\na: 1\n---\n# Titel\nText\n## Teil')).toEqual([
      [3, 0, 'Titel'],
      [5, 1, 'Teil'],
    ])
    expect(outline('richtext', '<h1>Titel</h1><p>Text</p><h2>Teil</h2>')).toEqual([
      [0, 0, 'Titel'],
      [1, 1, 'Teil'],
    ])
    for (const format of ['text', 'mindmap', 'canvas'] as const) {
      expect(hasOutline(format)).toBe(false)
      expect(noteOutline(format, '# Titel\n## Teil')).toEqual({ entries: [], truncated: false })
    }
  })

  it('rückt relativ zur Gliederung ein, nicht nach der Ebene', () => {
    expect(outline('markdown', '# A\n### B\n## C\n#### D\n# E').map(([, depth]) => depth)).toEqual([0, 1, 1, 2, 0])
    expect(outline('markdown', '## A\n### B\n## C').map(([, depth]) => depth)).toEqual([0, 1, 0])
  })

  it('zeigt höchstens 1 000 Einträge', () => {
    const { entries, truncated } = noteOutline('markdown', '## x\n'.repeat(MAX_OUTLINE_ENTRIES + 5))
    expect(MAX_OUTLINE_ENTRIES).toBe(1000)
    expect(entries).toHaveLength(MAX_OUTLINE_ENTRIES)
    expect(truncated).toBe(true)
    expect(noteOutline('markdown', '## x\n'.repeat(MAX_OUTLINE_ENTRIES)).truncated).toBe(false)
  })
})

describe('Überschriften in formatiertem Text', () => {
  it('liest Text mit Entities und Formatierung, h1–h3 in Dokumentreihenfolge', () => {
    const html =
      '<h1 style="text-align: center">Mathe &amp; <strong>Physik</strong></h1><p>x</p>' +
      '<h4>Zu tief</h4><h2>Über&shy;sicht<br>neu</h2><table><tr><td><h3>In Tabelle</h3></td></tr></table><H2>Groß</H2>'
    expect(richTextHeadings(html)).toEqual([
      { level: 1, text: 'Mathe & Physik' },
      { level: 2, text: 'Übersicht neu' },
      { level: 3, text: 'In Tabelle' },
      { level: 2, text: 'Groß' },
    ])
  })

  it('zählt leere Überschriften mit, zeigt sie aber nicht', () => {
    const html = '<h2>Erste</h2><h2></h2><h3><br></h3><h2>Vierte</h2>'
    expect(richTextHeadings(html).map((h) => h.text)).toEqual(['Erste', '', '', 'Vierte'])
    expect(outline('richtext', html)).toEqual([
      [0, 0, 'Erste'],
      [3, 0, 'Vierte'],
    ])
  })

  it('läuft auch bei vielen ungeschlossenen Überschriften in linearer Zeit', () => {
    for (const html of ['<h2>x'.repeat(200_000), '<h2 '.repeat(200_000), '<h1>a</h1>' + '<h2>'.repeat(200_000)]) {
      const t = Date.now()
      richTextHeadings(html)
      expect(Date.now() - t).toBeLessThan(2000)
    }
  })
})

describe('Aktueller Abschnitt', () => {
  const entries = noteOutline('markdown', 'Einleitung\n\n# A\nText\n## B\nText\n## C\nText').entries

  it('ist die letzte Überschrift an oder vor der Leseposition', () => {
    expect(entries.map((e) => e.key)).toEqual([2, 4, 6])
    // Ganz oben, noch vor der ersten Überschrift
    expect(currentEntry(entries, null, false)).toBe(0)
    expect(currentEntry(entries, 0, false)).toBe(0)
    // Mitten im Abschnitt und genau auf einer Überschrift
    expect(currentEntry(entries, 5, false)).toBe(1)
    expect(currentEntry(entries, 6, false)).toBe(2)
    expect(currentEntry(entries, 4, false)).toBe(1)
  })

  it('ist ganz unten die letzte und ohne Einträge keine', () => {
    expect(currentEntry(entries, 2, true)).toBe(2)
    expect(currentEntry([], 3, false)).toBe(-1)
    expect(currentEntry([], null, true)).toBe(-1)
  })
})
