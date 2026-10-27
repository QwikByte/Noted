import { describe, expect, it } from 'vitest'
import { cardsLimits, cardsPrompt, parseSuggestedCards } from './cards'
import { MAX_AI_CARDS } from './limits'
import type { PromptPart } from './prompt'
import type { CardsRequest } from './types'

const reply = (cards: unknown[]) => JSON.stringify({ cards })
const basic = (front: string, back = 'Antwort', page = 0) => ({ type: 'basic', front, back, options: [], page })
const card = (front: string, back = 'Antwort', page: number | null = null) => ({ type: 'basic', front, back, options: [], page })
const texts = (parts: PromptPart[]) => parts.flatMap((p) => (p.kind === 'text' ? [p.text] : ['[Bild]'])).join('\n\n')
const IMAGE = { mediaType: 'image/jpeg' as const, data: 'AAAA' }

describe('Anfrage an Claude', () => {
  it('schickt eine Notiz ohne Frontmatter, mit vorhandenen Karten und Wünschen', () => {
    const { system, parts } = cardsPrompt({
      source: { kind: 'note', noteId: 'n', title: 'Analysis I', content: '---\ntags: [uni]\n---\n# Grenzwerte\nEine Folge …' },
      existing: ['Was ist eine   Cauchy-Folge?', 'x'.repeat(400)],
      wishes: ' nur Definitionen ',
    })
    expect(system).toContain('aus ihren eigenen Notizen')
    expect(system).toContain('Setze page immer auf 0')
    const prompt = texts(parts)
    expect(prompt).toContain('Titel der Notiz: Analysis I')
    expect(prompt).toContain('<notiz>\n# Grenzwerte\nEine Folge …\n</notiz>')
    expect(prompt).not.toContain('tags: [uni]')
    expect(prompt).toContain('- Was ist eine Cauchy-Folge?')
    // Lange Vorderseiten nur angefangen
    expect(prompt).toContain(`- ${'x'.repeat(300)}\n`)
    expect(prompt).not.toContain('x'.repeat(301))
    expect(prompt).toMatch(/Wünsche zu den Karten: nur Definitionen$/)
  })

  it('lässt leere Teile weg', () => {
    const { parts } = cardsPrompt({ source: { kind: 'note', noteId: 'n', title: ' ', content: 'Text' }, existing: [' '], wishes: '' })
    expect(texts(parts)).toBe('Titel der Notiz: Ohne Titel\n\n<notiz>\nText\n</notiz>')
  })

  it('schickt PDF-Seiten mit Bild und Text und Markierungen mit Kommentar', () => {
    const { system, parts } = cardsPrompt({
      source: {
        kind: 'pdf',
        file: 'Physik/Skript.pdf',
        pages: [{ page: 3, text: ' Hauptsatz ', image: IMAGE }, { page: 4, text: '' }],
        marks: [
          { page: 3, quote: 'Energie bleibt erhalten', comment: 'klausurrelevant', image: undefined },
          { page: 5, quote: '', comment: '', image: IMAGE },
        ],
      },
    })
    expect(system).toContain('Gib in page die Seite an')
    expect(texts(parts)).toBe(
      [
        'PDF: Physik/Skript.pdf',
        'Seite 3:',
        '[Bild]',
        '<text seite="3">\nHauptsatz\n</text>',
        'Seite 4:',
        'Markierte Stellen:',
        '<markierung seite="3">\nZitat: Energie bleibt erhalten\nKommentar: klausurrelevant\n</markierung>',
        '[Bild]',
        '<markierung seite="5">\nBereich (siehe Bild)\n</markierung>',
      ].join('\n\n'),
    )
    expect(parts.filter((p) => p.kind === 'image')).toEqual([
      { kind: 'image', image: IMAGE },
      { kind: 'image', image: IMAGE },
    ])
  })

  it('überarbeitet oder teilt eine vorhandene Karte', () => {
    const source = {
      kind: 'card' as const,
      card: { type: 'mc' as const, front: 'Welche sind prim?', back: '', options: [{ text: '2', correct: true }, { text: '4', correct: false }] },
    }
    const improve = cardsPrompt({ source: { ...source, mode: 'improve' }, wishes: 'kürzer' })
    expect(improve.system).toContain('Gib genau eine Karte zurück')
    expect(texts(improve.parts)).toBe(
      '<karte>\nTyp: mc\nVorderseite:\nWelche sind prim?\nAntworten:\n- [x] 2\n- [ ] 4\n</karte>\n\nWünsche zu den Karten: kürzer',
    )
    expect(cardsPrompt({ source: { ...source, mode: 'split' } }).system).toContain('Teile sie in 2 bis 8 kleinere Karten auf')
  })

  it('begrenzt Anzahl und Seiten je Quelle', () => {
    const card: CardsRequest['source'] = { kind: 'card', mode: 'improve', card: { type: 'basic', front: 'a', back: 'b', options: [] } }
    expect(cardsLimits({ source: card })).toEqual({ max: 1, pages: new Set() })
    expect(cardsLimits({ source: { ...card, mode: 'split' } }).max).toBe(8)
    const pdf = cardsLimits({
      source: { kind: 'pdf', file: 'a.pdf', pages: [{ page: 2, text: '' }], marks: [{ page: 7, quote: 'x', comment: '' }] },
    })
    expect(pdf).toEqual({ max: MAX_AI_CARDS, pages: new Set([2, 7]) })
  })
})

describe('Antwort von Claude', () => {
  it('liest nur gültiges JSON im erwarteten Format', () => {
    expect(parseSuggestedCards('{"cards": [')).toBeNull()
    expect(parseSuggestedCards('{"karten": []}')).toBeNull()
    expect(parseSuggestedCards(reply([]))).toEqual([])
  })

  it('übernimmt Karten nach denselben Regeln wie beim Speichern', () => {
    const cards = parseSuggestedCards(
      reply([
        basic('  Was ist ein Körper?\r\n', ' Eine Menge mit + und · … '),
        { type: 'Reversed', front: 'Haus', back: 'house', options: [], page: 0 },
        { type: 'cloze', front: 'Die {{Ableitung}} von $x^2$ ist ==2x==.', back: '', options: [], page: 0 },
        { type: 'mc', front: 'Welche Zahl ist prim?', back: '', options: [{ text: '4', correct: false }, { text: ' 7\n', correct: true }] },
      ]),
    )
    expect(cards).toEqual([
      { type: 'basic', front: 'Was ist ein Körper?', back: 'Eine Menge mit + und · …', options: [], page: null },
      { type: 'reversed', front: 'Haus', back: 'house', options: [], page: null },
      { type: 'cloze', front: 'Die ==Ableitung== von $x^2$ ist ==2x==.', back: '', options: [], page: null },
      {
        type: 'mc',
        front: 'Welche Zahl ist prim?',
        back: '',
        options: [{ text: '4', correct: false }, { text: '7', correct: true }],
        page: null,
      },
    ])
  })

  it('verwirft unbrauchbare Karten einzeln', () => {
    const cards = parseSuggestedCards(
      reply([
        basic('Ohne Antwort', ' '),
        basic(' ', 'Ohne Frage'),
        { type: 'cloze', front: 'Ein Satz ohne Lücke', back: '', options: [] },
        { type: 'mc', front: 'Nur eine Antwort?', back: '', options: [{ text: 'ja', correct: true }] },
        { type: 'mc', front: 'Keine richtig?', back: '', options: [{ text: 'a', correct: false }, { text: 'b', correct: false }] },
        { type: 'occlusion', front: 'Bild', back: '', options: [] },
        { front: 'Ohne Typ' },
        basic('x'.repeat(20_001)),
        basic('Bleibt'),
      ]),
    )
    expect(cards).toEqual([card('Bleibt')])
  })

  it('behält nur Seiten, die Claude bekommen hat', () => {
    const cards = parseSuggestedCards(reply([basic('Aus Seite 3', 'a', 3), basic('Erfundene Seite', 'b', 99)]), {
      pages: new Set([3, 4]),
    })
    expect(cards).toEqual([card('Aus Seite 3', 'a', 3), card('Erfundene Seite', 'b', null)])
  })

  it('nimmt jede Vorderseite nur einmal und höchstens `max` Karten', () => {
    expect(parseSuggestedCards(reply([basic('Was ist  Entropie?'), basic('was ist entropie?', 'Andere')]))).toEqual([
      card('Was ist  Entropie?'),
    ])
    const many = Array.from({ length: MAX_AI_CARDS + 5 }, (_, i) => basic(`Frage ${i}`))
    expect(parseSuggestedCards(reply(many))).toHaveLength(MAX_AI_CARDS)
    expect(parseSuggestedCards(reply(many), { max: 1 })).toHaveLength(1)
  })
})
