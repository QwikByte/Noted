import { describe, expect, it } from 'vitest'
import { noteStats, wordsIn } from './note-stats'
import { serializeCanvas } from '@/features/canvas/canvas'

const words = (n: number) => Array.from({ length: n }, (_, i) => `wort${i}`).join(' ')

describe('Wortzahl', () => {
  it('zählt in Markdown nur den lesbaren Text', () => {
    const md = [
      '---',
      'title: Nicht zählen',
      '---',
      '# Überschrift',
      '[Skript](https://example.org/a/b/c) [[Analysis|Ana]] [[bild.png]] ![[foto.jpg]]',
      '```',
      'code zählt nicht',
      '```',
      '%%Kommentar auch nicht%%',
    ].join('\n')
    expect(noteStats('markdown', md).words).toBe(3)
  })

  it('zählt Bindestrich-Wörter und Zahlen wie Word als ein Wort', () => {
    expect(wordsIn('markdown', 'E-Mail an Müller’s Büro: 3,14 und 1.000,50 – fertig')).toBe(8)
    expect(wordsIn('text', 'Ende- - und -Anfang')).toBe(3)
  })

  it('zählt formatierten Text ohne HTML', () => {
    expect(noteStats('richtext', '<h1>Titel</h1><p>Ein <strong>fetter</strong> Satz <span style="color: #ff0000">rot</span></p>').words).toBe(5)
  })

  it('zählt einfachen Text unverändert', () => {
    expect(noteStats('text', '**fett** `code`').words).toBe(2)
  })

  it('zählt die Punkte einer Mindmap und die Karten eines Canvas', () => {
    expect(noteStats('mindmap', '# Thema\n- Ast eins\n  - Zweig').words).toBe(4)
    const canvas = serializeCanvas({
      nodes: [
        { id: 'a', type: 'text', text: 'Erste Karte', x: 0, y: 0, width: 100, height: 100 },
        { id: 'b', type: 'text', text: 'Zweite **Karte**', x: 200, y: 0, width: 100, height: 100 },
      ],
      edges: [{ id: 'e', fromNode: 'a', toNode: 'b', label: 'führt zu' }],
    })
    expect(noteStats('canvas', canvas).words).toBe(6)
  })

  it('kommt mit leeren Notizen zurecht', () => {
    for (const format of ['markdown', 'richtext', 'text', 'mindmap', 'canvas'] as const) {
      expect(noteStats(format, '')).toEqual({ words: 0, chars: 0, readingMinutes: null })
    }
  })

  it('zählt Zeichen wie bisher im Text der Notiz', () => {
    expect(noteStats('markdown', '**ab**').chars).toBe(6)
    expect(noteStats('richtext', '<p>ab</p>').chars).toBe(2)
  })
})

describe('Lesezeit', () => {
  it('nennt erst ab 30 Wörtern eine Lesezeit, gerundet auf Minuten bei 200 Wörtern pro Minute', () => {
    expect(noteStats('markdown', words(29)).readingMinutes).toBeNull()
    expect(noteStats('markdown', words(30)).readingMinutes).toBe(1)
    expect(noteStats('markdown', words(200)).readingMinutes).toBe(1)
    expect(noteStats('markdown', words(450)).readingMinutes).toBe(2)
  })
})
