import { describe, expect, it } from 'vitest'
import { localDate } from '@/features/calendar/dates'
import { DAY, MINUTE, formatInterval, fuzzInterval, previewIntervals, schedule, cardStatus, type Plan, type Rating } from './srs'
import {
  LearnSession,
  PracticeSession,
  allItems,
  cardLapses,
  cardsByDeck,
  deckCounts,
  isCorrectSelection,
  isProblemCard,
  movedSides,
  remapSides,
  reviewKey,
  sidesOf,
  stateMap,
  filterItems,
} from './study'
import { cardToMarkdown, deckToMarkdown, deckTag, parseCardsFromNote } from './card-markdown'
import type { Card, CardReview, SrsState } from './types'

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
    occlusion: null,
    position: Number(id.replace(/\D/g, '')) || 0,
    suspended: false,
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

  it('folgt den Lernschritten des Stapels – auch über Tage und nach dem Vergessen', () => {
    const plan: Plan = { kind: 'sm2', learningSteps: [10, 60, 1440], relearningSteps: [30] }
    const p = previewIntervals(null, NOW, plan)
    // Schwer im ersten Schritt: Mitte zwischen erstem und zweitem
    expect([p[1], p[2], p[3]]).toEqual([10 * MINUTE, 35 * MINUTE, 60 * MINUTE])
    const s1 = schedule(null, 3, NOW, plan)
    const s2 = schedule(s1, 3, NOW + 60 * MINUTE, plan)
    expect(s2).toMatchObject({ phase: 'learning', step: 2 })
    expect(s2.due - (NOW + 60 * MINUTE)).toBe(1440 * MINUTE)
    const s3 = schedule(s2, 3, s2.due, plan)
    expect(s3).toMatchObject({ phase: 'review', interval: 1 })
    const lapsed = schedule(s3, 1, s3.due, plan)
    expect(lapsed).toMatchObject({ phase: 'relearning', lapses: 1 })
    expect(lapsed.due - s3.due).toBe(30 * MINUTE)
    // Ohne eigene Schritte wie bisher
    expect(schedule(null, 3, NOW, { kind: 'sm2' }).due - NOW).toBe(10 * MINUTE)
    expect(schedule(null, 3, NOW, { kind: 'sm2', learningSteps: [] }).due - NOW).toBe(10 * MINUTE)
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

describe('Streuung der Abstände (Fuzz)', () => {
  const FSRS: Plan = { kind: 'fsrs', retention: 0.9 }
  const learn = (key: string, ratings: Rating[], plan?: Plan) => {
    let state: SrsState | null = null
    let t = NOW
    for (const r of ratings) {
      state = schedule(state, r, t, plan, key)
      t = state.due
    }
    return state!
  }

  it('verteilt gemeinsam gelernte Karten auf mehrere Tage statt alle auf denselben', () => {
    for (const plan of [undefined, FSRS]) {
      const days = new Set(Array.from({ length: 50 }, (_, i) => learn(`karte-${i}:0`, [3, 3, 3, 3], plan).due))
      expect(days.size).toBeGreaterThan(1)
    }
  })

  it('bleibt ohne Schlüssel beim genauen Abstand', () => {
    const days = new Set(Array.from({ length: 10 }, () => run([3, 3, 3, 3]).due))
    expect(days.size).toBe(1)
  })

  it('streut in den Bereichen von Anki', () => {
    const range = (days: number, min?: number) => [fuzzInterval(days, 0, min), fuzzInterval(days, 0.999999, min)]
    expect(range(2.4)).toEqual([2, 2])
    expect(range(2.5)).toEqual([2, 4])
    expect(range(7)).toEqual([5, 9])
    expect(range(20)).toEqual([17, 23])
    expect(range(100)).toEqual([93, 107])
    expect(range(36_500)).toEqual([34_673, 36_500])
    expect(range(3, 3)).toEqual([3, 4])
    expect(fuzzInterval(10, null)).toBe(10)
    expect(fuzzInterval(10.4, null, 12)).toBe(12)
  })

  it('hält Schwer ≤ Gut < Einfach ein und lässt Lernschritte in Minuten unverändert', () => {
    for (let i = 0; i < 200; i++) {
      for (const plan of [undefined, FSRS]) {
        const key = `c${i}:1`
        const review = learn(key, [3, 3, 3], plan)
        const [hard, good, easy] = ([2, 3, 4] as Rating[]).map((r) => schedule(review, r, review.due, plan, key).interval)
        expect(hard <= good && good < easy).toBe(true)
        expect(schedule(null, 3, NOW, plan, key).due - NOW).toBe(10 * MINUTE)
        const graduated = ([3, 4] as Rating[]).map((r) => schedule(schedule(null, 3, NOW, plan, key), r, NOW, plan, key).interval)
        expect(graduated[0] < graduated[1]).toBe(true)
      }
    }
  })

  it('beschriftet die Knöpfe mit genau dem Abstand, den die Bewertung plant – auch etwas später', () => {
    for (const plan of [undefined, FSRS]) {
      const review = learn('karte-7:0', [3, 3, 3, 3], plan)
      const shown = review.due
      const preview = previewIntervals(review, shown, plan, 'karte-7:0')
      for (const r of [2, 3, 4] as Rating[]) {
        const later = shown + 5000
        const days = Math.round((schedule(review, r, later, plan, 'karte-7:0').due - later) / DAY)
        expect(days).toBe(Math.round(preview[r] / DAY))
      }
    }
  })
})

describe('Leichtigkeit', () => {
  it('bleibt nach beliebig vielen „Einfach“ bei höchstens 10 – mehr nimmt der Server nicht an', () => {
    const learned = run([4], NOW - 5 * DAY)
    expect(schedule({ ...learned, ease: 9.95 }, 4, learned.due).ease).toBe(10)
    let s: SrsState = learned
    for (let i = 0; i < 60; i++) s = schedule(s, 4, s.due)
    expect(s.ease).toBe(10)
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

  it('hält das Tageslimit auch beim Lernen der Karten einer Notiz ein', () => {
    const cards = Array.from({ length: 8 }, (_, i) => card(`c${i}`, { noteId: i >= 4 ? 'n1' : null }))
    const reviews: CardReview[] = [0, 1, 2].map((i) => ({ cardId: `c${i}`, side: 0 as const, ...schedule(null, 4, NOW - 60 * MINUTE) }))
    const fromNote = (c: Card) => c.noteId === 'n1'
    const session = new LearnSession([deck], cards, stateMap(reviews), NOW, fromNote)
    const seen: string[] = []
    for (let item = session.next(NOW); item; item = session.next(NOW)) seen.push(item.card.id)
    // Limit 3, davon heute schon 3 im Stapel eingeführt → keine weiteren neuen Karten
    expect(seen).toEqual([])
    const fresh = new LearnSession([deck], cards, new Map(), NOW, fromNote)
    expect(fresh.remaining()).toEqual({ new: 3, learning: 0, review: 0 })
  })

  it('nimmt eine ausgesetzte Karte mit allen Seiten aus der Sitzung – auch aus der Lernphase', () => {
    const cards = [card('c1', { type: 'reversed' }), card('c2'), card('c3')]
    const reviews: CardReview[] = [
      { cardId: 'c1', side: 0, ...run([4], NOW - 5 * DAY) },
      { cardId: 'c1', side: 1, ...run([4], NOW - 6 * DAY) },
    ]
    const session = new LearnSession([{ id: 'd1', newPerDay: 20 }], cards, stateMap(reviews), NOW)
    // Von c1 kommt nur eine Seite heute (Geschwister), dazu die neuen c2 und c3
    expect(session.remaining()).toEqual({ new: 2, learning: 0, review: 1 })
    // c2 vergessen: kommt in der Lernphase wieder
    session.answered({ card: cards[1], side: 0, kind: 'new' }, schedule(null, 1, NOW), NOW)
    session.skipCard('c1')
    session.skipCard('c2')
    const rest: string[] = []
    for (let item = session.next(NOW); item; item = session.next(NOW)) rest.push(item.card.id)
    expect(rest).toEqual(['c3'])
  })

  it('Übungsmodus: ausgesetzte Karten kommen nicht mehr dran und zählen nicht mit', () => {
    const cards = [card('c1', { type: 'reversed' }), card('c2')]
    const session = new PracticeSession(allItems(cards), () => 0.5)
    expect(session.total).toBe(3)
    const first = session.next()!
    session.answered(first, false)
    session.skipCard(first.card.id)
    const rest: string[] = []
    for (let item = session.next(); item; item = session.next()) rest.push(item.card.id)
    expect(rest.every((id) => id !== first.card.id)).toBe(true)
    expect(session.total).toBe(first.card.id === 'c1' ? 1 : 2)
    expect(session.missed(allItems(cards))).toEqual([])
  })

  describe('Geschwister einer Karte', () => {
    const plan = { id: 'd1', newPerDay: 20 }
    const ids = (session: LearnSession) => {
      const seen: string[] = []
      for (let item = session.next(NOW); item; item = session.next(NOW)) seen.push(`${item.card.id}:${item.side}`)
      return seen
    }

    it('fragt von einem Lückentext je Tag nur eine fällige Lücke ab – die am längsten überfällige', () => {
      const cloze = card('c1', { type: 'cloze', front: '==Paris== ist die Hauptstadt von ==Frankreich==, ==Berlin== nicht.' })
      const reviews: CardReview[] = [
        { cardId: 'c1', side: 0, ...run([4], NOW - 6 * DAY) },
        { cardId: 'c1', side: 1, ...run([4], NOW - 8 * DAY) },
        { cardId: 'c1', side: 2, ...run([4], NOW - 7 * DAY) },
      ]
      const states = stateMap(reviews)
      expect(ids(new LearnSession([plan], [cloze], states, NOW))).toEqual(['c1:1'])
      expect(deckCounts(plan, [cloze], states, NOW)).toMatchObject({ review: 1, due: 1, dueTomorrow: 2 })
      // Am nächsten Tag die nächste
      const answered = stateMap([...reviews.filter((r) => r.side !== 1), { cardId: 'c1', side: 1, ...schedule(states.get('c1:1')!, 3, NOW) }])
      expect(ids(new LearnSession([plan], [cloze], answered, NOW + DAY))).toEqual(['c1:2'])
    })

    it('fragt keine Seite mehr ab, wenn heute schon eine gelernt wurde – Lernschritte laufen weiter', () => {
      const reversed = card('c1', { type: 'reversed' })
      const today = { cardId: 'c1', side: 0 as const, ...schedule(run([4], NOW - 6 * DAY), 3, NOW - 60 * MINUTE) }
      const due = { cardId: 'c1', side: 1 as const, ...run([4], NOW - 6 * DAY) }
      expect(ids(new LearnSession([plan], [reversed], stateMap([today, due]), NOW))).toEqual([])
      // Heute vergessen (Wiederlernen in 10 Minuten): kommt trotzdem wieder
      const relearning = { ...today, ...schedule(run([4], NOW - 6 * DAY), 1, NOW - 60 * MINUTE) }
      expect(ids(new LearnSession([plan], [reversed], stateMap([relearning, due]), NOW))).toEqual(['c1:0'])
    })

    it('bringt keine neue Seite, wenn heute eine andere Seite der Karte dran ist', () => {
      const reversed = card('c1', { type: 'reversed' })
      const due = { cardId: 'c1', side: 0 as const, ...run([4], NOW - 6 * DAY) }
      expect(ids(new LearnSession([plan], [reversed], stateMap([due]), NOW))).toEqual(['c1:0'])
      expect(deckCounts(plan, [reversed], stateMap([due]), NOW)).toMatchObject({ newToday: 0, review: 1 })
    })

    it('stellt am Tag vor der Klausur nichts zurück', () => {
      const cloze = card('c1', { type: 'cloze', front: '==a== und ==b==' })
      const reviews: CardReview[] = [
        { cardId: 'c1', side: 0, ...run([4], NOW - 6 * DAY) },
        { cardId: 'c1', side: 1, ...run([4], NOW - 7 * DAY) },
      ]
      const tomorrow = { ...plan, exams: [{ id: 'k', title: 'Klausur', date: localDate(new Date(NOW + DAY)) }] }
      expect(ids(new LearnSession([tomorrow], [cloze], stateMap(reviews), NOW)).sort()).toEqual(['c1:0', 'c1:1'])
      const later = { ...plan, exams: [{ id: 'k', title: 'Klausur', date: localDate(new Date(NOW + 5 * DAY)) }] }
      expect(ids(new LearnSession([later], [cloze], stateMap(reviews), NOW))).toHaveLength(1)
    })
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

  it('Rückgängig: die Karte kommt sofort wieder, die angezeigte danach – die Lernphase ist wie vorher', () => {
    const cards = [card('c1'), card('c2'), card('c3')]
    const session = new LearnSession([{ id: 'd1', newPerDay: 20 }], cards, new Map(), NOW)
    const before = session.remaining()
    const first = session.next(NOW)!
    session.answered(first, schedule(null, 1, NOW), NOW)
    const second = session.next(NOW)!
    expect(second.card.id).toBe('c2')
    session.answered(second, schedule(null, 4, NOW), NOW)
    const third = session.next(NOW)!
    // Zweimal zurück bis zum Anfang: c1 kommt wieder dran, ohne den eingereihten Lernschritt
    session.undo(second, third)
    session.undo(first, session.next(NOW))
    expect(session.remaining()).toEqual(before)
    const order: string[] = []
    for (let item = session.next(NOW); item; item = session.next(NOW)) order.push(`${item.card.id}:${item.kind}`)
    expect(order).toEqual(['c1:new', 'c2:new', 'c3:new'])
  })

  it('Rückgängig nach „Nochmal“ bei der letzten Karte: sie kommt nur einmal wieder', () => {
    const session = new LearnSession([{ id: 'd1', newPerDay: 20 }], [card('c1')], new Map(), NOW)
    const first = session.next(NOW)!
    session.answered(first, schedule(null, 1, NOW), NOW)
    // Sonst ist nichts mehr übrig – die wieder eingereihte Seite wird gleich angezeigt
    const again = session.next(NOW)!
    expect(again).toMatchObject({ kind: 'learning' })
    session.undo(first, again)
    expect(session.remaining()).toEqual({ new: 1, learning: 0, review: 0 })
    expect(session.next(NOW)).toMatchObject({ kind: 'new', card: { id: 'c1' } })
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

  it('lässt ausgesetzte Karten beim Lernen und Üben weg', () => {
    const cards = [card('c1'), card('c2', { suspended: true }), card('c3', { suspended: true })]
    const reviews: CardReview[] = [{ cardId: 'c3', side: 0, ...run([4], NOW - 10 * DAY) }]
    expect(deckCounts(deck, cards, stateMap(reviews), NOW)).toMatchObject({ total: 1, newTotal: 1, review: 0, due: 1 })
    const session = new LearnSession([deck], cards, stateMap(reviews), NOW)
    expect(session.next(NOW)!.card.id).toBe('c1')
    expect(session.next(NOW)).toBeNull()
    expect(allItems(cards).map((i) => i.card.id)).toEqual(['c1'])
  })

  it('erkennt Problemkarten ab 6-mal vergessen – bei beidseitigen Karten an der schwächeren Seite', () => {
    const forgotten = (lapses: number): SrsState => ({ ...run([4], NOW - DAY), lapses })
    const cards = [card('c1'), card('c2', { type: 'reversed' }), card('c3')]
    const states = stateMap([
      { cardId: 'c1', side: 0, ...forgotten(5) },
      { cardId: 'c2', side: 0, ...forgotten(1) },
      { cardId: 'c2', side: 1, ...forgotten(7) },
    ])
    expect(cards.map((c) => cardLapses(c, states))).toEqual([5, 7, 0])
    expect(cards.map((c) => isProblemCard(c, states))).toEqual([false, true, false])
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

  it('gruppiert auch große Stapel schnell nach Stapel, in der bisherigen Reihenfolge', () => {
    // Große Anki-Decks: Bisher wurde je Karte die Liste ihres Stapels kopiert – bei 50 000 Karten rund 19 s
    const cards = Array.from({ length: 50_000 }, (_, i) => card(`c${i}`, { deckId: i % 1000 === 0 ? 'd2' : 'd1' }))
    const start = performance.now()
    const byDeck = cardsByDeck(cards)
    expect(performance.now() - start).toBeLessThan(1000)
    expect(byDeck.get('d1')).toHaveLength(49_950)
    expect(byDeck.get('d2')?.map((c) => c.id)).toEqual(Array.from({ length: 50 }, (_, i) => `c${i * 1000}`))
    expect(byDeck.get('d1')?.slice(0, 2).map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(byDeck.has('d3')).toBe(false)
  })
})

describe('Lernstand beim Bearbeiten', () => {
  const cloze = (front: string) => ({ type: 'cloze' as const, front })

  it('ordnet Lücken über ihren Text zu', () => {
    const before = cloze('==A== und ==B== und ==C==')
    expect(remapSides(before, before)).toEqual([0, 1, 2])
    // Vorne eingefügt, in der Mitte gelöscht, umgestellt
    expect(remapSides(before, cloze('==X== ==A== ==B== ==C=='))).toEqual([null, 0, 1, 2])
    expect(remapSides(before, cloze('==A== und B und ==C=='))).toEqual([0, 2])
    expect(remapSides(before, cloze('==C== ==A== ==B=='))).toEqual([2, 0, 1])
    expect(remapSides(cloze('==A== ==B== ==C== ==D=='), cloze('==B== ==A== ==D== ==C=='))).toEqual([1, 0, 3, 2])
    // Leerzeichen am Rand der Lücke zählen nicht
    expect(remapSides(before, cloze('== A == und ==B== und ==C=='))).toEqual([0, 1, 2])
  })

  it('behält den Stand umformulierter Lücken, wenn die Zuordnung eindeutig ist', () => {
    const before = cloze('==sin== ist ==cos== und ==tan==')
    expect(remapSides(before, cloze('==Sinus== ist ==cos== und ==Tangens=='))).toEqual([0, 1, 2])
    // Zwei Lücken werden zu einer: nicht eindeutig, also neu
    expect(remapSides(before, cloze('==sin und cos== und ==tan=='))).toEqual([null, 2])
    // Gleicher Text mehrfach: in Reihenfolge
    expect(remapSides(cloze('==x== + ==x== = ==2x=='), cloze('==x== = ==2x=='))).toEqual([0, 2])
  })

  it('bleibt bei anderen Kartenarten und beim Wechsel der Art bei der Position', () => {
    const basic = { type: 'basic' as const, front: 'Frage' }
    const reversed = { type: 'reversed' as const, front: 'Frage' }
    expect(remapSides(reversed, basic)).toEqual([0])
    expect(remapSides(basic, reversed)).toEqual([0, null])
    expect(remapSides(cloze('==A== ==B=='), reversed)).toEqual([0, 1])
    expect([...movedSides([null, 0, 2])]).toEqual([
      [0, 1],
      [2, 2],
    ])
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

  it('erkennt Lückentexte: {{Lücke}} eindeutig, ==Markierung== als Vorschlag', () => {
    const note = [
      '# Ableitungen',
      'Die Ableitung von {{sin}} ist {{cos}}.',
      '',
      'Wichtig: ==Kettenregel== nicht vergessen',
      'und ==Produktregel== auch.',
      '',
      'Begriff::Erklärung mit ==Markierung==',
      '**Fett**: mit ==Markierung==',
      '```',
      'Code mit {{kein}} Lückentext',
      '```',
      'Vorlage vom {{date}}',
    ].join('\n')
    const cards = parseCardsFromNote(note).filter((c) => c.type === 'cloze')
    expect(cards.map((c) => [c.source, c.front, c.line])).toEqual([
      ['cloze', 'Die Ableitung von ==sin== ist ==cos==.', 1],
      ['highlight', 'Wichtig: ==Kettenregel== nicht vergessen\nund ==Produktregel== auch.', 3],
    ])
  })

  it('fragt jede Lücke für sich ab – höchstens eine neue Lücke je Karte und Tag', () => {
    const cloze = card('c1', { type: 'cloze', front: '==a== ==b== ==c==', back: '' })
    expect(sidesOf(cloze)).toEqual([0, 1, 2])
    expect(sidesOf(card('c2', { type: 'cloze', front: 'ohne Lücke' }))).toEqual([])
    const fresh = new LearnSession([{ id: 'd1', newPerDay: 20 }], [cloze], new Map(), NOW)
    expect(fresh.size).toBe(1)
    // Gestern Lücke 1 gelernt: heute kommt Lücke 2 dazu, Lücke 3 erst morgen
    const reviews: CardReview[] = [{ cardId: 'c1', side: 0, ...schedule(null, 4, NOW - 2 * DAY) }]
    const later = new LearnSession([{ id: 'd1', newPerDay: 20 }], [cloze], stateMap(reviews), NOW)
    const items: number[] = []
    for (let item = later.next(NOW); item; item = later.next(NOW)) items.push(item.side)
    expect(items).toEqual([1])
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
      card('c6', { type: 'cloze', front: 'Die Hauptstadt von ==Frankreich== ist ==Paris==.', back: 'Seit 987' }),
    ]
    const md = deckToMarkdown({ name: 'Analysis I', description: 'Klausur WS' }, cards)
    expect(md).toContain('  - flashcards/Analysis-I\n')
    expect(cardToMarkdown(cards[0])).toBe('Hauptstadt von Frankreich::Paris')
    expect(cardToMarkdown(cards[1])).toBe('Haus:::house')
    expect(cardToMarkdown(cards[5])).toBe('Die Hauptstadt von ==Frankreich== ist ==Paris==.\nSeit 987')
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

describe('Eigene Übungen', () => {
  const state = (patch: Partial<SrsState>): SrsState => ({
    phase: 'review',
    step: 0,
    interval: 10,
    ease: 2.5,
    reps: 5,
    lapses: 0,
    due: NOW,
    reviewedAt: NOW - DAY,
    introducedAt: NOW - 30 * DAY,
    ...patch,
  })
  const cards = [card('c1'), card('c2', { type: 'reversed' }), card('c3'), card('c4', { suspended: true }), card('c5')]
  const states = new Map<string, SrsState>([
    [reviewKey('c1', 0), state({ lapses: 7, difficulty: 6 })],
    [reviewKey('c2', 0), state({ difficulty: 9 })],
    [reviewKey('c2', 1), state({ lapses: 6, difficulty: 2 })],
    [reviewKey('c3', 0), state({ ease: 1.3, lapses: 2 })],
    [reviewKey('c4', 0), state({ lapses: 9, difficulty: 10 })],
  ])
  const keys = (items: { card: Card; side: number }[]) => items.map((i) => reviewKey(i.card.id, i.side))

  it('Problemkarten: alle Seiten, ohne ausgesetzte Karten', () => {
    expect(keys(filterItems('problem', cards, states))).toEqual(['c1:0', 'c2:0', 'c2:1'])
  })

  it('Schwerste: FSRS und SM-2 gemeinsam sortiert, neue Karten nicht, bei Gleichstand die öfter vergessenen', () => {
    // c3 (Leichtigkeit am Minimum) ist so schwer wie es SM-2 kennt, c2:0 hat FSRS-Schwierigkeit 9
    expect(keys(filterItems('hardest', cards, states))).toEqual(['c3:0', 'c2:0', 'c1:0', 'c2:1'])
    expect(keys(filterItems('hardest', cards, states, { limit: 2 }))).toEqual(['c3:0', 'c2:0'])
    const tie = new Map([
      [reviewKey('c1', 0), state({ lapses: 1 })],
      [reviewKey('c3', 0), state({ lapses: 3 })],
    ])
    expect(keys(filterItems('hardest', cards, tie))).toEqual(['c3:0', 'c1:0'])
  })

  it('Heute vergessen: genau die übergebenen Seiten', () => {
    const again = new Set(['c2:1', 'c4:0', 'c5:0'])
    expect(keys(filterItems('again-today', cards, states, { again }))).toEqual(['c2:1', 'c5:0'])
    expect(filterItems('again-today', cards, states)).toEqual([])
  })
})
