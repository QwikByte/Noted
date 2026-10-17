import { describe, expect, it } from 'vitest'
import { ankiCardKind, ankiClozeNumbers, ankiDeckName, ankiFieldToMarkdown, ankiMediaRefs, ankiState } from './anki'

const media = (name: string) => (name === 'herz.png' ? 'herz 1.png' : name.endsWith('.mp3') ? name : null)

describe('Anki-Felder umwandeln', () => {
  it('macht aus HTML Markdown – Formatierung, Zeilen, Listen und Entitäten', () => {
    expect(ankiFieldToMarkdown('<b>Herz</b> &amp; <i>Kreislauf</i><br>zweite&nbsp;Zeile<div>dritte</div>', media)).toBe(
      '**Herz** & *Kreislauf*\nzweite Zeile\ndritte',
    )
    expect(ankiFieldToMarkdown('<ul><li>eins</li><li>zwei</li></ul>', media)).toBe('- eins\n- zwei')
    expect(ankiFieldToMarkdown('H<sub>2</sub>O <span style="color:red">rot</span>', media)).toBe('H<sub>2</sub>O rot')
  })

  it('wandelt Lücken, MathJax und LaTeX um', () => {
    expect(ankiFieldToMarkdown('{{c1::Paris}} ist die Hauptstadt von {{c2::Frankreich::Land}}', media)).toBe(
      '==Paris== ist die Hauptstadt von ==Frankreich==',
    )
    expect(ankiFieldToMarkdown('\\(x^2\\) und \\[\\int f\\] und [latex]a=b[/latex] und [$]c[/$]', media)).toBe(
      '$x^2$ und $$\\int f$$ und $$a=b$$ und $c$',
    )
  })

  it('bettet Bilder und Töne als Anhänge ein', () => {
    expect(ankiMediaRefs('<img src="herz.png"> [sound:ton.mp3] <img src=\'a&amp;b.jpg\'>')).toEqual(['herz.png', 'a&b.jpg', 'ton.mp3'])
    expect(ankiFieldToMarkdown('<img src="herz.png" /> [sound:ton.mp3] <img src="fehlt.jpg">', media)).toBe('![[herz 1.png]] ![[ton.mp3]]')
  })

  it('übernimmt Stapelnamen samt Unterstapeln', () => {
    expect(ankiDeckName('Uni::Analysis I')).toBe('Uni – Analysis I')
    expect(ankiDeckName('Uni\x1fAnalysis')).toBe('Uni – Analysis')
    expect(ankiDeckName('  ')).toBe('Anki')
  })
})

describe('Anki-Karten zuordnen', () => {
  it('erkennt Lückentext, beidseitige und Grundkarten', () => {
    const cloze = ankiCardKind({ fields: ['{{c1::a}} {{c2::b}}', ''], ords: [0, 1] })
    expect(cloze.type).toBe('cloze')
    expect([0, 1, 2].map(cloze.sideOfOrd)).toEqual([0, 1, null])
    // Lücken nicht in Reihenfolge: Lernstand beginnt neu
    expect(ankiCardKind({ fields: ['{{c2::a}} {{c1::b}}'], ords: [0, 1] }).sideOfOrd(0)).toBeNull()
    expect(ankiClozeNumbers('{{c2::a}} {{c1::b::Hinweis}}')).toEqual([2, 1])
    expect(ankiCardKind({ fields: ['Haus', 'house'], ords: [0, 1] }).type).toBe('reversed')
    const basic = ankiCardKind({ fields: ['Haus', 'house'], ords: [0] })
    expect([basic.type, basic.sideOfOrd(0), basic.sideOfOrd(1)]).toEqual(['basic', 0, null])
  })

  it('übernimmt den Lernstand von Wiederholungen und Lernschritten', () => {
    const crt = 1_700_000_000
    const now = 1_760_000_000_000
    const card = { type: 2, queue: 2, due: 100, ivl: 30, factor: 2300, reps: 9, lapses: 1 }
    expect(ankiState(card, crt, now - 5000, now)).toEqual({
      phase: 'review',
      step: 0,
      interval: 30,
      ease: 2.3,
      reps: 9,
      lapses: 1,
      due: (crt + 100 * 86_400) * 1000,
      reviewedAt: now - 5000,
      introducedAt: now - 5000,
    })
    const learning = ankiState({ ...card, type: 1, queue: 1, due: 1_760_000_600, ivl: 0, factor: 0 }, crt, null, now)
    expect(learning).toMatchObject({ phase: 'learning', due: 1_760_000_600_000, ease: 2.5, reviewedAt: now })
    expect(ankiState({ ...card, type: 0, queue: 0 }, crt, null, now)).toBeNull()
  })
})
