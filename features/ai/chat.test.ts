import { describe, expect, it } from 'vitest'
import { CHAT_SYSTEM, chatTools, chatUserContent, parseProposal, toolLabel } from './chat'
import { applyChatEvent, type ChatPart } from './client/chat'

const names = (web: boolean) => chatTools(web).map((t) => ('name' in t ? t.name : t.type))

describe('KI-Chat: Anfrage', () => {
  it('Werkzeuge in fester Reihenfolge, die Websuche nur auf Wunsch und am Ende', () => {
    expect(names(false)).toEqual([
      'search_notes',
      'read_note',
      'list_notes',
      'search_files',
      'read_file',
      'search_cards',
      'study_overview',
      'list_events',
      'propose_note',
      'propose_cards',
      'propose_event',
    ])
    expect(names(true).at(-1)).toBe('web_search')
    // Gleich bleibende Bytes je Chat: Sonst verfielen Gedankengänge und Zwischenspeicher
    expect(JSON.stringify(chatTools(true))).toBe(JSON.stringify(chatTools(true)))
    expect(CHAT_SYSTEM).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('schreibt Datum und Bezug in die Frage, Bilder vor den Text', () => {
    const blocks = chatUserContent(
      { text: ' Erklär mir das ', images: [{ mediaType: 'image/png', data: 'AAAA' }] },
      [
        { kind: 'note', id: 'n1', title: 'Entropie' },
        { kind: 'pdf', file: 'Skript.pdf', page: 3 },
      ],
      { date: '2026-10-28', time: '14:05' },
    )
    expect(blocks).toEqual([
      {
        type: 'text',
        text: '<app-kontext>\nHeute: Mittwoch, 28.10.2026, 14:05 Uhr\nGerade geöffnet: Notiz „Entropie“ (ID n1)\nGerade geöffnet: PDF „Skript.pdf“, Seite 3\n</app-kontext>',
      },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      { type: 'text', text: 'Erklär mir das' },
    ])
  })

  it('beschriftet Werkzeugaufrufe für den Chat', () => {
    expect(toolLabel('search_notes', { query: 'Entropie' })).toBe('Durchsucht Notizen nach „Entropie“')
    expect(toolLabel('read_file', { file: 'Skript.pdf', pages: '3-5' })).toBe('Liest „Skript.pdf“ (S. 3-5)')
    expect(toolLabel('propose_cards', { cards: [{}, {}] })).toBe('Schlägt 2 Karteikarten vor')
    expect(toolLabel('web_search', { query: 'x'.repeat(100) })).toMatch(/^Sucht im Netz nach „x+…“$/)
    expect(toolLabel('study_overview', null)).toBe('Sieht sich den Lernstand an')
  })
})

describe('KI-Chat: Vorschläge', () => {
  const resolve = (ref: string) => (ref === 'Wärmelehre' ? 'n1' : null)

  it('Notiz: Titel bereinigt, leerer Inhalt abgelehnt', () => {
    expect(parseProposal('propose_note', { title: 'Lernzettel: Thermo/Hauptsätze', content: '# Inhalt' }, resolve)).toEqual({
      proposal: { kind: 'note', title: 'Lernzettel- Thermo-Hauptsätze', content: '# Inhalt\n' },
    })
    expect(parseProposal('propose_note', { title: 'X', content: '  ' }, resolve)).toEqual({ error: 'Der Inhalt ist leer.' })
  })

  it('Karten: unvollständige fallen weg, die Notiz wird über ihren Titel gefunden', () => {
    const result = parseProposal(
      'propose_cards',
      {
        cards: [
          { type: 'basic', front: 'Was ist Entropie?', back: 'Unordnung' },
          { type: 'basic', front: 'Ohne Antwort', back: '' },
          { type: 'cloze', front: 'Die ==Entropie== nimmt zu.', back: '' },
        ],
        deck: '  Thermo  ',
        note: 'Wärmelehre',
      },
      resolve,
    )
    expect(result).toEqual({
      proposal: {
        kind: 'cards',
        deck: 'Thermo',
        noteId: 'n1',
        cards: [
          { type: 'basic', front: 'Was ist Entropie?', back: 'Unordnung', options: [], page: null },
          { type: 'cloze', front: 'Die ==Entropie== nimmt zu.', back: '', options: [], page: null },
        ],
      },
    })
    expect(parseProposal('propose_cards', { cards: [{ type: 'basic', front: 'x', back: '' }] }, resolve)).toMatchObject({ error: expect.any(String) })
  })

  it('Termin: eine Stunde ohne Ende, ganztägig bis einschließlich des letzten Tages, ungültige Angaben als Fehler', () => {
    expect(parseProposal('propose_event', { title: 'Lerngruppe', start: '2026-11-02T18:00', location: 'Bib' }, resolve)).toMatchObject({
      proposal: { kind: 'event', event: { title: 'Lerngruppe', allDay: false, start: '2026-11-02T18:00', end: '2026-11-02T19:00', location: 'Bib' } },
    })
    expect(parseProposal('propose_event', { title: 'Klausurwoche', start: '2026-11-09', end: '2026-11-13' }, resolve)).toMatchObject({
      proposal: { event: { allDay: true, start: '2026-11-09', end: '2026-11-14' } },
    })
    expect(parseProposal('propose_event', { title: 'Kaputt', start: 'morgen früh' }, resolve)).toMatchObject({ error: expect.stringContaining('gültiges Datum') })
    expect(parseProposal('propose_event', { title: '', start: '2026-11-02T18:00' }, resolve)).toEqual({ error: 'Bitte gib einen Titel ein.' })
  })
})

describe('KI-Chat: Antwort im Browser', () => {
  it('setzt Text, Werkzeuge und Vorschläge in der Reihenfolge zusammen und verwirft nach einem Modellwechsel nur den Schritt', () => {
    let parts: ChatPart[] = []
    parts = applyChatEvent(parts, { text: 'Ich ' }, 0)
    parts = applyChatEvent(parts, { text: 'suche.' }, 0)
    parts = applyChatEvent(parts, { tool: { id: 't1', label: 'Durchsucht Notizen nach „x“' } }, 0)
    parts = applyChatEvent(parts, { toolDone: { id: 't1', label: 'Liest „x“' } }, 0)
    const stepStart = parts.length
    parts = applyChatEvent(parts, { text: 'Erster Versuch' }, stepStart)
    parts = applyChatEvent(parts, { reset: true }, stepStart)
    parts = applyChatEvent(parts, { text: 'Antwort' }, stepStart)
    expect(parts).toEqual([
      { kind: 'text', text: 'Ich suche.' },
      { kind: 'tool', id: 't1', label: 'Liest „x“', done: true, error: undefined },
      { kind: 'text', text: 'Antwort' },
    ])
  })
})
