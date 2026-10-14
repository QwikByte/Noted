import { describe, expect, it } from 'vitest'
import { DAY, MINUTE, formatInterval, previewIntervals, schedule, cardStatus, type Rating } from '@/lib/shared/srs'
import { LearnSession, PracticeSession, deckCounts, isCorrectSelection, reviewKey, stateMap, allItems } from '@/lib/shared/study'
import { cardToMarkdown, deckToMarkdown, deckTag, parseCardsFromNote } from '@/lib/shared/card-markdown'
import type { Card, CardReview, SrsState } from '@/lib/shared/types'

const NOW = new Date('2026-10-14T10:00:00').getTime()

function card(id: string, patch: Partial<Card> = {}): Card {
  return {
    id,
    deckId: 'd1',
    noteId: null,
    type: 'basic',
    front: `Frage ${id}`,
    back: `Antwort ${id}`,
    options: [],
    position: Number(id.replace(/\D/g, '')) || 0,
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  }
}

function run(ratings: Rating[], start = NOW, gap = (s: SrsState) => s.due - start) {
  let state: SrsState | null = null
  let t = start
  for (const r of ratings) {
    state = schedule(state, r, t)
    t = t + gap(state)
  }
  return state!
}

describe('Wiederholungsplan', () => {
  it('führt neue Karten durch die Lernschritte und dann in die Wiederholung', () => {
    const s1 = schedule(null, 3, NOW)
    expect(s1).toMatchObject({ phase: 'learning', step: 1, interval: 0, reps: 1, introducedAt: NOW })
    expect(s1.due - NOW).toBe(10 * MINUTE)
    const s2 = schedule(s1, 3, NOW + 10 * MINUTE)
    expect(s2).toMatchObject({ phase: 'review', interval: 1 })
    expect(s2.due).toBe(NOW + 10 * MINUTE + DAY)
    expect(s2.introducedAt).toBe(NOW)
  })

  it('„Nochmal“ in der Lernphase beginnt von vorn, „Einfach“ überspringt die Lernschritte', () => {
    expect(schedule(schedule(null, 3, NOW), 1, NOW).due - NOW).toBe(1 * MINUTE)
    expect(schedule(null, 2, NOW).due - NOW).toBe(5.5 * MINUTE)
    expect(schedule(null, 4, NOW)).toMatchObject({ phase: 'review', interval: 4 })
  })

  it('verlängert die Abstände bei gewussten Karten (Schwer < Gut < Einfach)', () => {
    const review = run([4]) // interval 4, ease 2.5
    const at = review.due
    const [hard, good, easy] = ([2, 3, 4] as Rating[]).map((r) => schedule(review, r, at))
    expect(hard.interval).toBe(5)
    expect(good.interval).toBe(10)
    expect(easy.interval).toBe(13)
    expect(hard.ease).toBe(2.35)
    expect(good.ease).toBe(2.5)
    expect(easy.ease).toBe(2.65)
    expect(hard.interval < good.interval && good.interval < easy.interval).toBe(true)
  })

  it('vergessene Karten werden neu gelernt, mit halbem Abstand und geringerer Leichtigkeit', () => {
    const review = { ...run([4]), interval: 20 }
    const lapsed = schedule(review, 1, review.due)
    expect(lapsed).toMatchObject({ phase: 'relearning', step: 0, interval: 10, lapses: 1, ease: 2.3 })
    expect(lapsed.due - review.due).toBe(10 * MINUTE)
    const back = schedule(lapsed, 3, lapsed.due)
    expect(back).toMatchObject({ phase: 'review', interval: 10 })
  })

  it('berücksichtigt verspätete Wiederholungen und hält die Leichtigkeit über dem Minimum', () => {
    const review = run([4])
    const late = schedule(review, 3, review.due + 10 * DAY)
    expect(late.interval).toBe(Math.round((4 + 5) * 2.5))
    let s: SrsState = review
    for (let i = 0; i < 20; i++) s = schedule({ ...s, phase: 'review' }, 2, s.due)
    expect(s.ease).toBe(1.3)
  })

  it('beschriftet die Knöpfe mit dem nächsten Abstand', () => {
    const p = previewIntervals(null, NOW)
    expect([p[1], p[2], p[3], p[4]].map(formatInterval)).toEqual(['1 Min.', '6 Min.', '10 Min.', '4 Tage'])
    expect(formatInterval(DAY)).toBe('1 Tag')
    expect(formatInterval(75 * DAY)).toBe('2,5 Mon.')
    expect(formatInterval(500 * DAY)).toBe('1,4 J.')
  })

  it('ordnet Karten einem Status zu', () => {
    expect(cardStatus(null)).toBe('new')
    expect(cardStatus(schedule(null, 3, NOW))).toBe('learning')
    expect(cardStatus({ ...run([4]), interval: 30 })).toBe('mature')
  })
})

describe('Lernsitzung', () => {
  const deck = { id: 'd1', newPerDay: 3 }

  it('zeigt fällige Wiederholungen und neue Karten bis zum Tageslimit', () => {
    const cards = Array.from({ length: 6 }, (_, i) => card(`c${i}`))
    const reviews: CardReview[] = [
      { cardId: 'c0', side: 0, ...run([4], NOW - 5 * DAY) }, // fällig
      { cardId: 'c1', side: 0, ...run([4], NOW - DAY) }, // noch nicht fällig
    ]
    const counts = deckCounts(deck, cards, stateMap(reviews), NOW)
    expect(counts).toMatchObject({ total: 6, newTotal: 4, newToday: 3, review: 1, learning: 0, due: 4 })
    const session = new LearnSession([deck], cards, stateMap(reviews), NOW)
    const seen: string[] = []
    for (let item = session.next(NOW); item; item = session.next(NOW)) seen.push(item.card.id)
    expect(seen).toEqual(['c0', 'c2', 'c3', 'c4'])
  })

  it('rechnet heute bereits eingeführte Karten auf das Limit an', () => {
    const cards = Array.from({ length: 6 }, (_, i) => card(`c${i}`))
    const reviews: CardReview[] = [
      { cardId: 'c0', side: 0, ...schedule(null, 4, NOW - 60 * MINUTE) },
      { cardId: 'c1', side: 0, ...schedule(null, 4, NOW - 30 * MINUTE) },
    ]
    expect(deckCounts(deck, cards, stateMap(reviews), NOW).newToday).toBe(1)
  })

  it('wiederholt Karten in der Lernphase innerhalb der Sitzung', () => {
    const cards = [card('c1'), card('c2')]
    const session = new LearnSession([{ id: 'd1', newPerDay: 20 }], cards, new Map(), NOW)
    const first = session.next(NOW)!
    expect(first.card.id).toBe('c1')
    const state = schedule(null, 1, NOW)
    session.answered(first, state, NOW)
    expect(session.remaining()).toEqual({ new: 1, learning: 1, review: 0 })
    // c1 ist erst in einer Minute wieder dran → zuerst c2
    expect(session.next(NOW)!.card.id).toBe('c2')
    // danach c1 – auch wenn die Minute noch nicht um ist (es gibt sonst nichts mehr)
    expect(session.next(NOW + 1000)!.card.id).toBe('c1')
    expect(session.next(NOW)).toBeNull()
  })

  it('fragt bei beidseitigen Karten die Rückseite erst ab einem späteren Tag ab', () => {
    const cards = [card('c1', { type: 'reversed' })]
    const fresh = new LearnSession([{ id: 'd1', newPerDay: 20 }], cards, new Map(), NOW)
    expect(fresh.size).toBe(1)
    const reviews: CardReview[] = [{ cardId: 'c1', side: 0, ...schedule(null, 4, NOW - 2 * DAY) }]
    const later = new LearnSession([{ id: 'd1', newPerDay: 20 }], cards, stateMap(reviews), NOW)
    const item = later.next(NOW)!
    expect(reviewKey(item.card.id, item.side)).toBe('c1:1')
  })

  it('Übungsmodus: falsche Antworten kommen wieder, gezählt wird der erste Versuch', () => {
    const items = allItems([card('c1'), card('c2', { type: 'reversed' })])
    expect(items).toHaveLength(3)
    const session = new PracticeSession(items, () => 0.5)
    const results: boolean[] = []
    let wrongOnce = false
    for (let item = session.next(); item; item = session.next()) {
      const ok = wrongOnce || item.card.id !== 'c1'
      if (!ok) wrongOnce = true
      session.answered(item, ok)
      results.push(ok)
    }
    expect(results.filter((r) => !r)).toHaveLength(1)
    expect(results).toHaveLength(4)
    expect(session.correctFirstTry).toBe(2)
    expect(session.missed(items).map((i) => i.card.id)).toEqual(['c1'])
  })

  it('prüft Multiple-Choice-Antworten exakt', () => {
    const options = [
      { text: 'a', correct: true },
      { text: 'b', correct: false },
      { text: 'c', correct: true },
    ]
    expect(isCorrectSelection(options, new Set([0, 2]))).toBe(true)
    expect(isCorrectSelection(options, new Set([0]))).toBe(false)
    expect(isCorrectSelection(options, new Set([0, 1, 2]))).toBe(false)
  })
})

describe('Karten in Notizen erkennen', () => {
  it('erkennt die Syntax des Spaced-Repetition-Plugins', () => {
    const note = [
      '---',
      'tags: [mathe]',
      '---',
      '# Analysis',
      'Was ist eine Folge?::Eine Abbildung ℕ → ℝ',
      '- Ableitung von sin:::cos',
      '`std::vector` ist kein Karte',
      '',
      'Nenne die Axiome',
      'eines Körpers',
      '?',
      'Assoziativität',
      'Kommutativität',
      '',
      'Welche Aussagen stimmen?',
      '?',
      '- [x] Jede konvergente Folge ist beschränkt',
      '- [ ] Jede beschränkte Folge konvergiert',
      '- [X] Der Grenzwert ist eindeutig',
      'Nach Bolzano-Weierstraß gibt es nur eine konvergente Teilfolge.',
      '',
      '```cpp',
      'a::b',
      '?',
      '```',
    ].join('\n')
    const cards = parseCardsFromNote(note).filter((c) => c.source === 'syntax')
    expect(cards).toEqual([
      { source: 'syntax', line: 4, type: 'basic', front: 'Was ist eine Folge?', back: 'Eine Abbildung ℕ → ℝ', options: [] },
      { source: 'syntax', line: 5, type: 'reversed', front: 'Ableitung von sin', back: 'cos', options: [] },
      { source: 'syntax', line: 8, type: 'basic', front: 'Nenne die Axiome\neines Körpers', back: 'Assoziativität\nKommutativität', options: [] },
      {
        source: 'syntax',
        line: 14,
        type: 'mc',
        front: 'Welche Aussagen stimmen?',
        back: 'Nach Bolzano-Weierstraß gibt es nur eine konvergente Teilfolge.',
        options: [
          { text: 'Jede konvergente Folge ist beschränkt', correct: true },
          { text: 'Jede beschränkte Folge konvergiert', correct: false },
          { text: 'Der Grenzwert ist eindeutig', correct: true },
        ],
      },
    ])
  })

  it('erkennt Frage-Callouts, Definitionen, fette Begriffe und Überschriften', () => {
    const note = [
      '## Definitionen',
      '> [!info] Stetigkeit',
      '> Für jedes ε gibt es ein δ …',
      '',
      '> [!question]- Was besagt der Zwischenwertsatz?',
      '> Jeder Wert zwischen f(a) und f(b) wird angenommen.',
      '',
      '> [!faq]',
      '> Wer hat den Satz bewiesen?',
      '> Bolzano',
      '',
      '> [!question]- Frage',
      '> Antwort (zum Aufklappen)',
      '',
      '- **Supremum**: kleinste obere Schranke',
      '**Infimum:** größte untere Schranke',
    ].join('\n')
    const cards = parseCardsFromNote(note)
    const bySource = (s: string) => cards.filter((c) => c.source === s).map((c) => [c.front, c.back])
    expect(bySource('definition')).toEqual([['Stetigkeit', 'Für jedes ε gibt es ein δ …']])
    expect(bySource('question')).toEqual([
      ['Was besagt der Zwischenwertsatz?', 'Jeder Wert zwischen f(a) und f(b) wird angenommen.'],
      ['Wer hat den Satz bewiesen?', 'Bolzano'],
    ])
    expect(bySource('bold')).toEqual([
      ['Supremum', 'kleinste obere Schranke'],
      ['Infimum', 'größte untere Schranke'],
    ])
    expect(bySource('heading')).toHaveLength(1)
    expect(bySource('heading')[0][0]).toBe('Definitionen')
  })

  it('liest tabulatorgetrennte Listen (Import aus Quizlet/Anki)', () => {
    const cards = parseCardsFromNote('Haus\thouse\nBaum\ttree\n\tEingerückt', { tabs: true })
    expect(cards.map((c) => [c.front, c.back])).toEqual([
      ['Haus', 'house'],
      ['Baum', 'tree'],
    ])
  })

  it('gibt Stapel im Plugin-Format aus und liest sie wieder ein', () => {
    const cards: Card[] = [
      card('c1', { front: 'Hauptstadt von Frankreich', back: 'Paris' }),
      card('c2', { type: 'reversed', front: 'Haus', back: 'house' }),
      card('c3', { front: 'Zeile 1\n\nZeile 2', back: 'Antwort mit `a::b`' }),
      card('c4', {
        type: 'mc',
        front: 'Primzahlen?',
        back: '',
        options: [
          { text: '2', correct: true },
          { text: '4', correct: false },
        ],
      }),
      card('c5', { front: 'C++: Namensraum::Name?', back: 'Qualifizierter Name' }),
    ]
    const md = deckToMarkdown({ name: 'Analysis I', description: 'Klausur WS' }, cards)
    expect(md).toContain('  - flashcards/Analysis-I\n')
    expect(cardToMarkdown(cards[0])).toBe('Hauptstadt von Frankreich::Paris')
    expect(cardToMarkdown(cards[1])).toBe('Haus:::house')
    const parsed = parseCardsFromNote(md).filter((c) => c.source === 'syntax')
    expect(parsed.map(({ type, front, back, options }) => ({ type, front, back, options }))).toEqual([
      { type: 'basic', front: 'Hauptstadt von Frankreich', back: 'Paris', options: [] },
      { type: 'reversed', front: 'Haus', back: 'house', options: [] },
      { type: 'basic', front: 'Zeile 1\nZeile 2', back: 'Antwort mit `a::b`', options: [] },
      { type: 'mc', front: 'Primzahlen?', back: '', options: cards[3].options },
      { type: 'basic', front: 'C++: Namensraum::Name?', back: 'Qualifizierter Name', options: [] },
    ])
    expect(deckTag('  ')).toBe('flashcards')
  })
})
