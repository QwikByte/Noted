import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { ADMIN_PASSWORD, call, loginAs, setupTestEnv } from '@/tests/helpers'
import * as settingsRoute from '@/app/api/ai/settings/route'
import * as cardsRoute from '@/app/api/ai/cards/route'
import * as assistRoute from '@/app/api/ai/assist/route'
import * as metaRoute from '@/app/api/ai/meta/route'
import * as gradeRoute from '@/app/api/ai/grade/route'
import * as questionsRoute from '@/app/api/ai/questions/route'
import * as decks from '@/app/api/decks/route'
import * as chatRoute from '@/app/api/ai/chat/route'
import * as calendar from '@/app/api/calendar/route'
import * as attachments from '@/app/api/attachments/route'
import { indexPending } from '@/features/attachments/server/index'
import { localDate } from '@/features/calendar/dates'
import { makePdf } from '@/tests/pdf'
import { CHAT_SYSTEM } from './chat'
import * as deckCards from '@/app/api/decks/[id]/cards/route'
import * as notes from '@/app/api/notes/route'
import * as users from '@/app/api/admin/users/route'
import * as password from '@/app/api/account/password/route'
import { getDb } from '@/shared/server/db'
import { MAX_AI_NOTE_CHARS } from './limits'
import { readAssistEvents } from './assist'

// Ein kleiner Nachbau der Anthropic-API: Das echte SDK spricht mit ihm (ANTHROPIC_BASE_URL), ohne dass ein Test ins
// Netz geht oder etwas kostet.
const GOOD_KEY = 'sk-ant-api03-gueltiger-test-schluessel-ABCD'

type Received = { method: string; path: string; key: string | null; beta: string | null; body: Record<string, any> | null } // eslint-disable-line @typescript-eslint/no-explicit-any
type Reply = { status: number; body: unknown } | { events: Record<string, unknown>[] }

const received: Received[] = []
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let messagesReply: (body: Record<string, any>) => Reply = () => success([])

const server = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (chunk) => (raw += chunk))
  req.on('end', () => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    const key = (req.headers['x-api-key'] as string | undefined) ?? req.headers.authorization?.replace(/^Bearer /, '') ?? null
    const beta = (req.headers['anthropic-beta'] as string | undefined) ?? null
    const body = raw ? JSON.parse(raw) : null
    received.push({ method: req.method ?? '', path, key, beta, body })
    let reply: Reply
    if (key !== GOOD_KEY) reply = apiError(401, 'authentication_error', 'invalid x-api-key')
    else if (path.startsWith('/v1/models/')) {
      const id = path.slice('/v1/models/'.length)
      reply = id === 'claude-fable-5-1' ? apiError(404, 'not_found_error', `model: ${id}`) : { status: 200, body: { id, type: 'model' } }
    } else reply = messagesReply(body)
    if ('events' in reply) {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const e of reply.events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
      res.end()
    } else {
      // Ohne Wiederholungsversuche des SDK, damit Fehlerfälle nicht warten
      res.writeHead(reply.status, { 'content-type': 'application/json', 'x-should-retry': 'false' })
      res.end(JSON.stringify(reply.body))
    }
  })
})

function apiError(status: number, type: string, message: string): Reply {
  return { status, body: { type: 'error', error: { type, message } } }
}

const text = (index: number, value: string) => [
  { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index, delta: { type: 'text_delta', text: value } },
  { type: 'content_block_stop', index },
]

function stream(blocks: Record<string, unknown>[], stopReason = 'end_turn'): Reply {
  const message = {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 1 },
  }
  return {
    events: [
      { type: 'message_start', message },
      ...blocks,
      { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 50 } },
      { type: 'message_stop' },
    ],
  }
}

const success = (cards: unknown[]) => stream(text(0, JSON.stringify({ cards })))
const basic = (front: string, back = 'Antwort') => ({ type: 'basic', front, back, options: [] })

let env: Awaited<ReturnType<typeof setupTestEnv>>
let token = ''
let other = ''

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  env = await setupTestEnv()
  token = await loginAs('admin', ADMIN_PASSWORD)
  await call(users.POST, '/api/admin/users', { cookie: token, body: { username: 'lena', password: 'Kennwort-Gast-4711' } })
  other = await loginAs('lena', 'Kennwort-Gast-4711')
  await call(password.POST, '/', { cookie: other, body: { currentPassword: 'Kennwort-Gast-4711', newPassword: 'Kennwort-Gast-4712' } })
})
afterAll(async () => {
  delete process.env.ANTHROPIC_BASE_URL
  await new Promise((resolve) => server.close(resolve))
  await env.cleanup()
})
beforeEach(() => {
  received.length = 0
  messagesReply = () => success([])
})

const settings = (cookie = token) => call(settingsRoute.GET, '/api/ai/settings', { cookie })
const save = (body: unknown, cookie = token) => call(settingsRoute.PUT, '/api/ai/settings', { method: 'PUT', cookie, body })
const auditEvents = () => getDb().prepare('SELECT event FROM audit_log ORDER BY id').pluck().all() as string[]

async function newNote(content: string, title = 'Thermodynamik') {
  const r = await call(notes.POST, '/', { cookie: token, body: { title, folderId: null, content } })
  expect(r.status).toBe(201)
  return r.data.note.id as string
}

const cards = (body: Record<string, unknown>, cookie = token) => call(cardsRoute.POST, '/api/ai/cards', { cookie, body })
/** Karten aus einer Notiz */
const suggest = (
  { noteId, title, content, existing, wishes }: { noteId: string; title?: string; content?: string; existing?: string[]; wishes?: string },
  cookie = token,
) => cards({ source: { kind: 'note', noteId, title, content }, existing, wishes }, cookie)

describe('KI-Einstellungen', () => {
  it('ist ohne Schlüssel aus', async () => {
    const r = await settings()
    expect(r.status).toBe(200)
    expect(r.data.settings).toEqual({ configured: false, model: 'claude-opus-5-5', keyHint: null, updatedAt: null })
  })

  it('prüft Format, Schlüssel und Modell, bevor etwas gespeichert wird', async () => {
    const format = await save({ apiKey: 'mein-schluessel', model: 'claude-opus-5-5' })
    expect(format.status).toBe(400)
    expect(format.data.message).toContain('sk-ant-')

    expect((await save({ apiKey: GOOD_KEY, model: 'gpt-5' })).status).toBe(400)
    expect((await save({ model: 'claude-opus-5-5' })).data).toMatchObject({ message: 'Bitte gib deinen API-Schlüssel ein.' })

    // Abgelehnter Schlüssel: verständliche Meldung, aber nie 401 – das hieße für die App „abgemeldet“
    const wrong = await save({ apiKey: 'sk-ant-api03-falsch', model: 'claude-opus-5-5' })
    expect(wrong.status).toBe(400)
    expect(wrong.data.error).toBe('ai_key_invalid')
    expect((await settings()).data.settings.configured).toBe(false)
    expect(received).toMatchObject([{ method: 'GET', path: '/v1/models/claude-opus-5-5', key: 'sk-ant-api03-falsch' }])
  })

  it('speichert den Schlüssel verschlüsselt und zeigt nur seine letzten Zeichen', async () => {
    const r = await save({ apiKey: ` ${GOOD_KEY} `, model: 'claude-sonnet-5-5' })
    expect(r.status).toBe(200)
    expect(r.data.settings).toMatchObject({ configured: true, model: 'claude-sonnet-5-5', keyHint: '…ABCD' })
    expect(received).toMatchObject([{ path: '/v1/models/claude-sonnet-5-5', key: GOOD_KEY }])

    const stored = getDb().prepare('SELECT api_key FROM ai_settings').pluck().get() as string
    expect(stored).not.toContain('gueltiger')
    expect(JSON.stringify((await settings()).data)).not.toContain('gueltiger')
    expect(auditEvents()).toContain('ai_key_saved')
  })

  it('wechselt das Modell mit dem hinterlegten Schlüssel, wenn er es nutzen darf', async () => {
    const unavailable = await save({ model: 'claude-fable-5-1' })
    expect(unavailable.status).toBe(400)
    expect(unavailable.data.error).toBe('ai_model_unavailable')
    expect((await settings()).data.settings.model).toBe('claude-sonnet-5-5')

    const events = auditEvents().length
    const r = await save({ model: 'claude-opus-5-5' })
    expect(r.data.settings).toMatchObject({ configured: true, model: 'claude-opus-5-5', keyHint: '…ABCD' })
    expect(received.at(-1)).toMatchObject({ path: '/v1/models/claude-opus-5-5', key: GOOD_KEY })
    // Nur ein neuer Schlüssel kommt ins Sicherheitsprotokoll
    expect(auditEvents()).toHaveLength(events)
  })

  it('gilt nur für das eigene Konto', async () => {
    expect((await settings(other)).data.settings.configured).toBe(false)
    const id = await newNote('Etwas')
    const r = await suggest({ noteId: id, title: 'x', content: 'Etwas' }, other)
    expect(r.status).toBe(400)
    expect(r.data.error).toBe('ai_not_configured')
    expect(received).toEqual([])
  })
})

const IMAGE = { mediaType: 'image/jpeg', data: 'AAAA' }

/** Tresor-Notiz des Admins – direkt in der Datenbank, der Server sieht nur den Umschlag */
function vaultNote() {
  const id = '11111111-2222-4333-8444-555555555555'
  const userId = getDb().prepare("SELECT id FROM users WHERE username = 'admin'").pluck().get()
  getDb()
    .prepare(`INSERT OR IGNORE INTO notes (id, user_id, title, content, vault, created_at, updated_at) VALUES (?, ?, '', 'nv1.x', 1, 0, 0)`)
    .run(id, userId)
  return id
}
/** Inhaltsblöcke der letzten Anfrage an Claude */
const lastContent = () => (received.at(-1)?.body?.messages[0].content ?? []) as { type: string; text?: string; source?: { data: string } }[]
const lastPrompt = () =>
  lastContent()
    .map((b) => b.text ?? '[Bild]')
    .join('\n\n')

describe('Karten aus PDFs und vorhandenen Karten', () => {
  it('schickt Seiten als Bild und Text, Markierungen mit Kommentar und behält nur bekannte Seiten', async () => {
    messagesReply = () => success([{ ...basic('Aus Seite 2'), page: 2 }, { ...basic('Erfundene Seite'), page: 9 }])
    const r = await cards({
      source: {
        kind: 'pdf',
        file: 'Physik/Skript.pdf',
        pages: [{ page: 2, text: 'Entropie nimmt zu.', image: IMAGE }],
        marks: [{ page: 3, quote: 'Energie bleibt erhalten', comment: 'wichtig' }],
      },
      wishes: 'nur das Wichtigste',
    })
    expect(r.status).toBe(200)
    expect(r.data.cards.map((c: { front: string; page: number | null }) => [c.front, c.page])).toEqual([
      ['Aus Seite 2', 2],
      ['Erfundene Seite', null],
    ])
    expect(lastContent().filter((b) => b.type === 'image')).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
    ])
    expect(lastPrompt()).toContain('<text seite="2">\nEntropie nimmt zu.\n</text>')
    expect(lastPrompt()).toContain('Zitat: Energie bleibt erhalten\nKommentar: wichtig')
    expect(received.at(-1)?.body?.system).toContain('Skript, ihren Folien')
  })

  it('lehnt leere Auswahl, zu viele und kaputte Bilder ab, ohne Claude zu fragen', async () => {
    const pdf = (pages: unknown[]) => cards({ source: { kind: 'pdf', file: 'a.pdf', pages, marks: [] } })
    expect((await pdf([])).data.message).toBe('Wähle Seiten oder Markierungen aus.')
    expect((await pdf([{ page: 1, text: '', image: { mediaType: 'image/jpeg', data: '<script>' } }])).status).toBe(400)
    const many = Array.from({ length: 21 }, (_, i) => ({ page: i + 1, text: 'x' }))
    expect((await pdf(many)).data.message).toContain('Höchstens 20 Seiten')
    expect(received).toEqual([])
  })

  it('überarbeitet eine Karte zu genau einer und teilt eine in mehrere auf', async () => {
    const card = { type: 'basic', front: 'Nenne alle Hauptsätze und erkläre sie', back: 'Viel Text', options: [] }
    messagesReply = () => success([basic('Erste'), basic('Zweite'), basic('Dritte')])
    const improved = await cards({ source: { kind: 'card', mode: 'improve', card }, wishes: 'kürzer' })
    expect(improved.data.cards).toEqual([{ ...basic('Erste'), page: null }])
    expect(lastPrompt()).toContain('Vorderseite:\nNenne alle Hauptsätze und erkläre sie')
    expect(lastPrompt()).toContain('Wünsche zu den Karten: kürzer')
    const split = await cards({ source: { kind: 'card', mode: 'split', card } })
    expect(split.data.cards).toHaveLength(3)
    expect(received.at(-1)?.body?.system).toContain('kleinere Karten')
  })
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assistCall(body: Record<string, any>, cookie = token) {
  const r = await call(assistRoute.POST, '/api/ai/assist', { cookie, body })
  const type = r.res.headers.get('content-type') ?? ''
  return { ...r, events: type.includes('ndjson') ? readAssistEvents((await r.res.text()) + '\n').events : [] }
}

const textBlock = (index: number, ...deltas: string[]) => [
  { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
  ...deltas.map((text) => ({ type: 'content_block_delta', index, delta: { type: 'text_delta', text } })),
  { type: 'content_block_stop', index },
]

describe('Assistent', () => {
  it('streamt den geänderten Abschnitt Stück für Stück', async () => {
    const id = await newNote('# Thermo\nEin sehr langer Absatz über Wärme.')
    messagesReply = () => stream(textBlock(0, 'Kurzer ', 'Absatz.'))
    const r = await assistCall({
      task: 'edit',
      instruction: 'Kürzen',
      title: 'Thermo',
      text: 'Ein sehr langer Absatz über Wärme.',
      context: '# Thermo\nEin sehr langer Absatz über Wärme.',
      noteId: id,
    })
    expect(r.status).toBe(200)
    expect(r.events).toEqual([{ text: 'Kurzer ' }, { text: 'Absatz.' }, { done: true, truncated: false }])
    const request = received.at(-1)?.body
    expect(request).toMatchObject({ stream: true, output_config: { effort: 'low' }, fallbacks: 'default' })
    expect(request?.output_config).not.toHaveProperty('format')
    expect(request?.system).toContain('Antworte ausschließlich mit dem neuen Text')
    expect(lastPrompt()).toContain('Auftrag: Kürzen')
  })

  it('beginnt nach einem Fallback neu und meldet Abbruch an der Längengrenze', async () => {
    const fallback = {
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-5' }, trigger: { type: 'refusal', category: 'bio' } },
    }
    messagesReply = () => stream([...textBlock(0, 'Anfang'), fallback, { type: 'content_block_stop', index: 1 }, ...textBlock(2, 'Neu')], 'max_tokens')
    const r = await assistCall({ task: 'answer', instruction: 'Erkläre das', title: 'Skript.pdf', text: '', images: [IMAGE] })
    expect(r.events).toEqual([{ text: 'Anfang' }, { reset: true }, { text: 'Neu' }, { done: true, truncated: true }])
    expect(lastContent()[1]).toMatchObject({ type: 'image' })
  })

  it('meldet Ablehnung im Strom und Fehler von Anthropic vorher als normale Antwort', async () => {
    const body = { task: 'answer', instruction: 'Erkläre das', title: 'x', text: 'Inhalt' }
    messagesReply = () => stream([], 'refusal')
    expect((await assistCall(body)).events).toEqual([expect.objectContaining({ code: 'ai_refused' })])

    messagesReply = () => apiError(529, 'overloaded_error', 'overloaded')
    const overloaded = await assistCall(body)
    expect([overloaded.status, overloaded.data.error]).toEqual([503, 'ai_overloaded'])
  })

  it('lehnt Tresor-Notizen, leere Aufträge und fehlenden Text ab', async () => {
    const vault = await assistCall({ task: 'edit', instruction: 'Kürzen', title: 'x', text: 'Geheim', noteId: vaultNote() })
    expect([vault.status, vault.data.error]).toEqual([400, 'vault'])
    expect((await assistCall({ task: 'edit', instruction: ' ', title: 'x', text: 'Text' })).status).toBe(400)
    expect((await assistCall({ task: 'answer', instruction: 'Was?', title: 'x', text: ' ' })).status).toBe(400)
    expect(received.filter((r) => r.path === '/v1/messages')).toEqual([])
  })
})

describe('Titel und Tags', () => {
  it('schlägt einen Titel und Tags vor – bevorzugt vorhandene, ohne die der Notiz', async () => {
    await newNote('Wärme #physik', 'Wärmelehre')
    const id = await newNote('Energie bleibt erhalten. #mechanik', 'Unbenannt')
    messagesReply = () => stream(textBlock(0, JSON.stringify({ title: 'Energieerhaltung', tags: ['physik', 'mechanik', 'Erhaltungs Sätze'] })))
    const r = await call(metaRoute.POST, '/api/ai/meta', {
      cookie: token,
      body: { noteId: id, title: 'Unbenannt', content: 'Energie bleibt erhalten. #mechanik' },
    })
    expect(r.status).toBe(200)
    expect(r.data).toEqual({ title: 'Energieerhaltung', tags: ['physik', 'erhaltungs-sätze'] })
    expect(lastPrompt()).toMatch(/Vorhandene Tags der Person: .*physik/)
    expect(lastPrompt()).toContain('Tags der Notiz: mechanik')
    expect(received.at(-1)?.body?.output_config.format.schema.required).toEqual(['title', 'tags'])
  })

  it('lehnt Tresor-Notizen ab', async () => {
    const r = await call(metaRoute.POST, '/api/ai/meta', {
      cookie: token,
      body: { noteId: vaultNote(), title: 'x', content: 'Geheim' },
    })
    expect([r.status, r.data.error]).toEqual([400, 'vault'])
  })
})

const grade = (body: unknown, cookie = token) => call(gradeRoute.POST, '/api/ai/grade', { cookie, body })
const questions = (body: unknown, cookie = token) => call(questionsRoute.POST, '/api/ai/questions', { cookie, body })
const json = (value: unknown) => stream(textBlock(0, JSON.stringify(value)))

describe('Antworten bewerten', () => {
  it('bewertet eine eingetippte Antwort schnell und schickt unbeantwortete Aufgaben nicht mit', async () => {
    messagesReply = () => json({ results: [{ nr: 1, verdict: 'partial', points: 0.5, feedback: 'Die Einheit fehlt.' }] })
    const r = await grade({
      title: 'Thermo',
      items: [
        { question: 'Wie groß ist ΔU?', expected: '5 J', answer: '5' },
        { question: 'Leer', expected: 'x', answer: ' ' },
      ],
    })
    expect(r.status).toBe(200)
    expect(r.data.results).toEqual([
      { verdict: 'partial', points: 0.5, feedback: 'Die Einheit fehlt.' },
      { verdict: 'wrong', points: 0, feedback: 'Keine Antwort.' },
    ])
    expect(received.at(-1)?.body?.output_config.effort).toBe('low')
    expect(lastPrompt()).toContain('<aufgabe nr="1">')
    expect(lastPrompt()).not.toContain('nr="2"')

    received.length = 0
    const none = await grade({ title: 'x', items: [{ question: 'A', expected: 'a', answer: '' }] })
    expect(none.data.results).toEqual([{ verdict: 'wrong', points: 0, feedback: 'Keine Antwort.' }])
    expect(received).toEqual([])
  })

  it('korrigiert eine Probeklausur mit Fotos und Punkten sorgfältiger', async () => {
    messagesReply = () =>
      json({
        results: [
          { nr: 1, verdict: 'correct', points: 3, feedback: 'Gut.' },
          { nr: 2, verdict: 'partial', points: 7.4, feedback: 'Rechenfehler in b).' },
        ],
      })
    const r = await grade({
      title: 'Klausur Thermo',
      items: [
        { question: 'Definiere Entropie.', expected: '…', answer: 'Maß für Unordnung', points: 3 },
        { question: 'Rechne.', expected: 'a) 2 P. b) 4 P.', answer: '', images: [IMAGE, IMAGE], points: 6 },
      ],
    })
    expect(r.data.results.map((x: { points: number }) => x.points)).toEqual([3, 6])
    expect(received.at(-1)?.body?.output_config.effort).toBe('medium')
    expect(lastContent().filter((b) => b.type === 'image')).toHaveLength(2)
    expect(lastPrompt()).toContain('<aufgabe nr="2" punkte="6">')
  })

  it('lehnt Tresor-Notizen und zu viele Fotos ab, ohne Claude zu fragen', async () => {
    const vault = await grade({ title: 'x', noteId: vaultNote(), context: 'Geheim', items: [{ question: 'A', expected: 'a', answer: 'b' }] })
    expect([vault.status, vault.data.error]).toEqual([400, 'vault'])
    const items = Array.from({ length: 9 }, () => ({ question: 'A', expected: 'a', answer: '', images: [IMAGE, IMAGE, IMAGE] }))
    expect((await grade({ title: 'x', items })).data.message).toContain('Höchstens 24 Fotos')
    expect(received).toEqual([])
  })
})

describe('Fragen stellen', () => {
  it('Tutor: Verständnisfragen zu einer Notiz', async () => {
    const id = await newNote('# Entropie\nEntropie nimmt zu.', 'Wärme')
    messagesReply = () => json({ questions: [{ question: 'Warum nimmt die Entropie zu?', answer: 'Weil …', points: 5, topic: 'Entropie' }] })
    const r = await questions({ source: { kind: 'note', noteId: id, title: 'Wärme', content: '# Entropie\nEntropie nimmt zu.' }, count: 5 })
    expect(r.status).toBe(200)
    expect(r.data).toEqual({ questions: [{ question: 'Warum nimmt die Entropie zu?', answer: 'Weil …', points: 1, topic: 'Entropie' }], truncated: false })
    expect(received.at(-1)?.body?.system).toContain('Höchstens 5 Fragen')
    const vault = await questions({ source: { kind: 'note', noteId: vaultNote(), title: 'x', content: 'Geheim' }, count: 5 })
    expect(vault.data.error).toBe('vault')
  })

  it('Probeklausur: Karten der Stapel und ihre Notizen lädt der Server selbst', async () => {
    const noteId = await newNote('# Hauptsätze\nEnergie bleibt erhalten.', 'Hauptsätze')
    const deck = await call(decks.POST, '/api/decks', { cookie: token, body: { name: 'Thermo-Klausur' } })
    const deckId = deck.data.deck.id as string
    await call(deckCards.POST, '/', {
      cookie: token,
      params: { id: deckId },
      body: { cards: [{ type: 'basic', front: 'Was besagt der erste Hauptsatz?', back: 'Energieerhaltung', noteId }] },
    })
    messagesReply = () => json({ questions: [{ question: 'Erläutern Sie den ersten Hauptsatz.', answer: '2 P. für …', points: 4, topic: 'Hauptsätze' }] })
    const r = await questions({ source: { kind: 'decks', title: 'Klausur Thermo', deckIds: [deckId] }, count: 10, wishes: 'mit Rechnung' })
    expect(r.status).toBe(200)
    expect(r.data.questions[0]).toMatchObject({ points: 4 })
    expect(lastPrompt()).toContain('<karte>\nWas besagt der erste Hauptsatz?\n→ Energieerhaltung\n</karte>')
    expect(lastPrompt()).toContain('<notiz titel="Hauptsätze">\n# Hauptsätze\nEnergie bleibt erhalten.\n</notiz>')
    expect(lastPrompt()).toContain('Wünsche der Person: mit Rechnung')
    expect(received.at(-1)?.body?.system).toContain('Genau 10 Aufgaben')

    // Fremde Stapel gibt es für andere Konten nicht, leere Stapel taugen nicht
    received.length = 0
    await save({ apiKey: GOOD_KEY, model: 'claude-sonnet-5-5' }, other)
    received.length = 0
    const foreign = await questions({ source: { kind: 'decks', title: 'x', deckIds: [deckId] }, count: 5 }, other)
    expect(foreign.status).toBe(404)
    const empty = await call(decks.POST, '/api/decks', { cookie: token, body: { name: 'Leer' } })
    const none = await questions({ source: { kind: 'decks', title: 'x', deckIds: [empty.data.deck.id] }, count: 5 })
    expect(none.data.message).toContain('noch keine Karten')
    expect(received).toEqual([])
  })

  it('Problemkarten: bis zu vier leichter merkbare Karten', async () => {
    messagesReply = () => success(['A', 'B', 'C', 'D', 'E'].map((f) => basic(f)))
    const r = await cards({ source: { kind: 'card', mode: 'leech', card: { type: 'basic', front: 'Alles über Entropie', back: 'Viel', options: [] } } })
    expect(r.data.cards).toHaveLength(4)
    expect(received.at(-1)?.body?.system).toContain('Problemkarte')
  })
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>

const toolUse = (index: number, id: string, name: string, input: unknown) => [
  { type: 'content_block_start', index, content_block: { type: 'tool_use', id, name, input: {} } },
  { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } },
  { type: 'content_block_stop', index },
]

/** Werkzeugergebnisse in der letzten Nachricht einer Anfrage an Claude */
const lastResults = (body: Json): Json[] => {
  const content = body.messages.at(-1).content
  return Array.isArray(content) ? content.filter((b: Json) => b.type === 'tool_result') : []
}

const today = localDate(new Date())
const chatBody = (text: string, extra: Json = {}) => ({
  history: [],
  question: { text, images: [], refs: [] },
  now: { date: today, time: '14:05' },
  web: false,
  ...extra,
})

async function chatCall(body: unknown, cookie = token) {
  const r = await call(chatRoute.POST, '/api/ai/chat', { cookie, body })
  const type = r.res.headers.get('content-type') ?? ''
  const events: Json[] = type.includes('ndjson') ? readAssistEvents<Json>((await r.res.text()) + '\n').events : []
  return { ...r, events, text: events.filter((e) => 'text' in e).map((e) => e.text).join('') }
}

const messageRequests = () => received.filter((r) => r.path === '/v1/messages')

describe('KI-Chat', () => {
  it('liest Notizen über Werkzeuge, antwortet mit Quelle und liefert den Verlauf zum Weiterführen', async () => {
    const id = await newNote('# Entropie\nDie Entropie nimmt in abgeschlossenen Systemen nie ab.', 'Entropie-Chat')
    messagesReply = (body) => {
      const results = lastResults(body)
      if (!results.length) return stream(toolUse(0, 'tu1', 'search_notes', { query: 'Entropie' }), 'tool_use')
      if (results[0].tool_use_id === 'tu1') return stream(toolUse(0, 'tu2', 'read_note', { note: 'Entropie-Chat' }), 'tool_use')
      return stream(textBlock(0, 'Laut [[Entropie-Chat]] ', 'nimmt sie nie ab.'))
    }
    const r = await chatCall(chatBody('Was weiß ich über Entropie?', { question: { text: 'Was weiß ich über Entropie?', images: [], refs: [{ kind: 'note', id, title: 'falscher Titel' }] } }))
    expect(r.status).toBe(200)
    expect(r.events.filter((e) => 'step' in e)).toHaveLength(3)
    expect(r.events.filter((e) => 'tool' in e).map((e) => e.tool.label)).toEqual(['Durchsucht Notizen nach „Entropie“', 'Liest „Entropie-Chat“'])
    expect(r.events.find((e) => e.toolDone?.id === 'tu2')?.toolDone).toEqual({ id: 'tu2', label: 'Liest „Entropie-Chat“' })
    expect(r.text).toBe('Laut [[Entropie-Chat]] nimmt sie nie ab.')
    expect(r.events.at(-1)).toEqual({ done: true, truncated: false })
    const added = r.events.find((e) => 'messages' in e)!.messages as Json[]
    expect(added.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant'])

    const last = messageRequests().at(-1)!
    expect(last.body?.system).toBe(CHAT_SYSTEM)
    expect(last.body?.tools.map((t: Json) => t.name)).not.toContain('web_search')
    expect(last.body?.thinking).toEqual({ type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } })
    expect(last.body?.cache_control).toEqual({ type: 'ephemeral' })
    expect(last.beta).toContain('thinking-binding-controls-2026-08-01')
    // Bezug mit dem Titel vom Server, Datum in der Frage statt in der Anweisung
    expect(last.body?.messages[0].content[0].text).toContain('Gerade geöffnet: Notiz „Entropie-Chat“')
    expect(last.body?.messages[0].content[0].text).toContain(`Heute: `)
    expect(JSON.stringify(last.body?.messages[4].content)).toContain('nimmt in abgeschlossenen Systemen nie ab')

    // Weiterführen: Der Verlauf geht Byte für Byte so zurück, wie er kam
    received.length = 0
    messagesReply = () => stream(textBlock(0, 'Gern.'))
    const next = await chatCall(chatBody('Danke', { history: added }))
    expect(next.text).toBe('Gern.')
    expect(messageRequests()[0].body?.messages.slice(0, 6)).toEqual(added)
  })

  it('zeigt Vorschläge zum Bestätigen und meldet fehlerhafte an Claude zurück', async () => {
    messagesReply = (body) =>
      lastResults(body).length
        ? stream(textBlock(0, 'Erledigt.'))
        : stream(
            [
              ...toolUse(0, 'p1', 'propose_cards', {
                cards: [
                  { type: 'basic', front: 'Was ist Entropie?', back: 'Unordnung' },
                  { type: 'basic', front: 'Leer', back: '' },
                ],
                deck: 'Thermo',
              }),
              ...toolUse(1, 'p2', 'propose_event', { title: 'Lerngruppe', start: 'irgendwann' }),
            ],
            'tool_use',
          )
    const r = await chatCall(chatBody('Mach Karten und einen Termin'))
    expect(r.events.find((e) => 'proposal' in e)?.proposal).toEqual({
      id: 'p1',
      proposal: { kind: 'cards', deck: 'Thermo', noteId: null, cards: [{ type: 'basic', front: 'Was ist Entropie?', back: 'Unordnung', options: [], page: null }] },
    })
    expect(r.events.find((e) => e.toolDone?.id === 'p2')?.toolDone.error).toContain('gültiges Datum')
    const results = lastResults(messageRequests().at(-1)!.body!)
    expect(results.map((x) => [x.tool_use_id, !!x.is_error])).toEqual([
      ['p1', false],
      ['p2', true],
    ])
    expect(results[0].content).toContain('Vorschlag')
  })

  it('fragt eine Runde mit unlesbarer Werkzeugeingabe neu an – auch die erste', async () => {
    let attempts = 0
    messagesReply = (body) => {
      if (lastResults(body).length) return stream(textBlock(0, 'Gefunden.'))
      if (attempts++ > 0) return stream(toolUse(0, 'j2', 'search_notes', { query: 'Entropie' }), 'tool_use')
      return stream(
        [
          { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'j1', name: 'search_notes', input: {} } },
          { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"query" "Entropie"}' } },
          { type: 'content_block_stop', index: 0 },
        ],
        'tool_use',
      )
    }
    const r = await chatCall(chatBody('Such mal'))
    expect(r.events.filter((e) => 'reset' in e)).toHaveLength(1)
    expect(r.text).toBe('Gefunden.')
    expect(messageRequests()).toHaveLength(3)
    // Der verworfene Versuch landet nicht im Verlauf
    expect(JSON.stringify(r.events.find((e) => 'messages' in e)?.messages)).not.toContain('j1')
  })

  it('kennt Lernstand, Kalender und Karteikarten', async () => {
    const deck = await call(decks.POST, '/api/decks', { cookie: token, body: { name: 'Chat-Stapel' } })
    const deckId = deck.data.deck.id as string
    await call(deckCards.POST, '/', { cookie: token, params: { id: deckId }, body: { cards: [{ type: 'basic', front: 'Was ist Enthalpie?', back: 'H = U + pV' }] } })
    const examDay = localDate(new Date(Date.now() + 10 * 86_400_000))
    const ev = await call(calendar.POST, '/api/calendar', {
      cookie: token,
      body: { title: 'Thermo-Klausur', location: 'HS 1', notes: '', color: null, allDay: false, start: `${examDay}T10:00`, end: `${examDay}T12:00`, repeat: null, exdates: [], exam: { deckIds: [deckId] } },
    })
    expect(ev.status).toBe(201)
    messagesReply = (body) =>
      lastResults(body).length
        ? stream(textBlock(0, 'Lern Enthalpie.'))
        : stream(
            [
              ...toolUse(0, 's1', 'study_overview', {}),
              ...toolUse(1, 's2', 'list_events', { from: examDay, to: examDay }),
              ...toolUse(2, 's3', 'search_cards', { query: 'Enthalpie' }),
            ],
            'tool_use',
          )
    const r = await chatCall(chatBody('Was soll ich lernen?'))
    expect(r.text).toBe('Lern Enthalpie.')
    const [overview, events, cards] = lastResults(messageRequests().at(-1)!.body!).map((x) => x.content as string)
    expect(overview).toMatch(/- Chat-Stapel: 1 Karten, heute fällig 1/)
    expect(overview).toContain('Klausur „Thermo-Klausur“')
    expect(events).toContain('10:00–12:00 Thermo-Klausur (HS 1, Klausur)')
    expect(cards).toContain('[Chat-Stapel] Was ist Enthalpie? → H = U + pV (basic, neu)')
  })

  it('liest PDF-Seiten aus der Volltextsuche', async () => {
    const form = new FormData()
    form.append('file', new File([new Uint8Array(makePdf([['Einleitung'], ['Carnot-Prozess', 'Wirkungsgrad']]))], 'Skript Chat.pdf'))
    expect((await call(attachments.POST, '/', { cookie: token, form })).status).toBe(201)
    await indexPending()
    messagesReply = (body) =>
      lastResults(body).length ? stream(textBlock(0, 'Siehe S. 2.')) : stream(toolUse(0, 'f1', 'read_file', { file: 'Skript Chat.pdf', pages: '2' }), 'tool_use')
    const r = await chatCall(chatBody('Was steht zum Carnot-Prozess im Skript?'))
    expect(r.events.find((e) => e.toolDone?.id === 'f1')?.toolDone.label).toBe('Liest „Skript Chat.pdf“ (S. 2)')
    const content = lastResults(messageRequests().at(-1)!.body!)[0].content as string
    expect(content).toContain('[[Skript Chat.pdf#page=2|S. 2]]')
    expect(content).toContain('Carnot-Prozess')
    expect(content).not.toContain('Einleitung')
  })

  it('schaltet die Websuche selbst aus, wenn sie für den Zugang abgeschaltet ist', async () => {
    messagesReply = () => stream(textBlock(0, 'Mit Netz.'))
    await chatCall(chatBody('Neuigkeiten?', { web: true }))
    expect(messageRequests().at(-1)!.body?.tools.at(-1)).toEqual({ type: 'web_search_20260209', name: 'web_search', max_uses: 5 })

    received.length = 0
    messagesReply = (body) =>
      body.tools.some((t: Json) => t.name === 'web_search')
        ? apiError(400, 'invalid_request_error', 'web search is not enabled for this organization')
        : stream(textBlock(0, 'Ohne Netz.'))
    const r = await chatCall(chatBody('Neuigkeiten?', { web: true }))
    expect(r.status).toBe(200)
    expect(r.events[0]).toEqual({ notice: expect.stringContaining('Websuche') })
    expect(r.text).toBe('Ohne Netz.')
    expect(r.events.find((e) => 'messages' in e)?.web).toBe(false)
    expect(messageRequests()).toHaveLength(2)
  })

  it('kommt nicht an Tresor-Notizen und lehnt beschädigte Verläufe ab', async () => {
    const vault = vaultNote()
    messagesReply = (body) =>
      lastResults(body).length ? stream(textBlock(0, 'Nichts gefunden.')) : stream(toolUse(0, 'v1', 'read_note', { note: vault }), 'tool_use')
    const r = await chatCall(chatBody('Was steht da?', { question: { text: 'Was steht da?', images: [], refs: [{ kind: 'note', id: vault, title: 'Geheim' }] } }))
    const firstQuestion = messageRequests()[0].body?.messages[0].content[0].text as string
    expect(firstQuestion).not.toContain('Geheim')
    expect(firstQuestion).not.toContain('Gerade geöffnet')
    expect(r.events.find((e) => e.toolDone?.id === 'v1')?.toolDone.error).toContain('Keine Notiz')

    received.length = 0
    const bad = await chatCall(
      chatBody('Hallo', { history: [{ role: 'user', content: [{ type: 'image', source: { type: 'url', url: 'http://intern/x.png' } }] }] }),
    )
    expect(bad.status).toBe(400)
    expect(bad.data.message).toContain('Verlauf')
    expect(received).toEqual([])
  })
})

describe('Karten vorschlagen', () => {
  it('schickt die Notiz mit Schema, Fallback und Wünschen und liefert geprüfte Karten', async () => {
    const id = await newNote('---\ntags: [physik]\n---\n# Hauptsätze\nEnergie bleibt erhalten.')
    messagesReply = () =>
      success([
        basic('Was besagt der erste Hauptsatz?', 'Energie bleibt erhalten.'),
        { type: 'Cloze', front: 'Die {{Entropie}} nimmt nicht ab.', back: '', options: [] },
        { type: 'cloze', front: 'Ohne Lücke', back: '', options: [] },
        basic('was besagt der erste  hauptsatz?', 'Doppelt'),
      ])
    const r = await suggest({
      noteId: id,
      title: 'Thermodynamik',
      content: '---\ntags: [physik]\n---\n# Hauptsätze\nEnergie bleibt erhalten.',
      existing: ['Was ist Wärme?'],
      wishes: 'auf Deutsch',
    })
    expect(r.status).toBe(200)
    expect(r.data.cards).toEqual([
      { type: 'basic', front: 'Was besagt der erste Hauptsatz?', back: 'Energie bleibt erhalten.', options: [], page: null },
      { type: 'cloze', front: 'Die ==Entropie== nimmt nicht ab.', back: '', options: [], page: null },
    ])

    expect(received).toHaveLength(1)
    const [request] = received
    expect(request).toMatchObject({ method: 'POST', path: '/v1/messages', key: GOOD_KEY })
    expect(request.beta).toContain('server-side-fallback-2026-07-01')
    expect(request.body).toMatchObject({
      model: 'claude-opus-5-5',
      stream: true,
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema' } },
    })
    expect(request.body?.output_config.format.schema.properties.cards.items.properties.type.enum).toEqual([
      'basic',
      'reversed',
      'cloze',
      'mc',
    ])
    expect(request.body?.system).toContain('Karteikarten')
    const prompt = (request.body?.messages[0].content as { text: string }[]).map((b) => b.text).join('\n\n')
    expect(prompt).toContain('# Hauptsätze\nEnergie bleibt erhalten.')
    expect(prompt).not.toContain('tags: [physik]')
    expect(prompt).toContain('- Was ist Wärme?')
    expect(prompt).toContain('Wünsche zu den Karten: auf Deutsch')
  })

  it('nimmt nach einem Fallback die Antwort des Modells, das zuletzt geschrieben hat', async () => {
    const id = await newNote('Viren und Bakterien')
    messagesReply = () =>
      stream([
        ...text(0, '{"cards": [{"type": "ba'),
        {
          type: 'content_block_start',
          index: 1,
          content_block: {
            type: 'fallback',
            from: { model: 'claude-opus-5-5' },
            to: { model: 'claude-opus-5' },
            trigger: { type: 'refusal', category: 'bio' },
          },
        },
        { type: 'content_block_stop', index: 1 },
        ...text(2, JSON.stringify({ cards: [basic('Was unterscheidet Viren von Bakterien?')] })),
      ])
    const r = await suggest({ noteId: id, title: 'Biologie', content: 'Viren und Bakterien' })
    expect(r.status).toBe(200)
    expect(r.data.cards).toEqual([{ ...basic('Was unterscheidet Viren von Bakterien?'), page: null }])
  })

  it('schickt bei Haiku keinen Fallback mit', async () => {
    expect((await save({ model: 'claude-haiku-5-5' })).status).toBe(200)
    received.length = 0
    const id = await newNote('Kurz')
    expect((await suggest({ noteId: id, title: 'Kurz', content: 'Kurz' })).status).toBe(200)
    expect(received[0].body).toMatchObject({ model: 'claude-haiku-5-5' })
    expect(received[0].body).not.toHaveProperty('fallbacks')
    expect(received[0].beta ?? '').not.toContain('server-side-fallback')
    expect((await save({ model: 'claude-opus-5-5' })).status).toBe(200)
  })

  it('übersetzt Ablehnung, abgeschnittene und unlesbare Antworten', async () => {
    const id = await newNote('Inhalt')
    const body = { noteId: id, title: 'Inhalt', content: 'Inhalt' }

    messagesReply = () => stream([], 'refusal')
    expect((await suggest(body)).data).toMatchObject({ error: 'ai_refused' })

    messagesReply = () => stream(text(0, '{"cards": [{"type": "basic", "fr'), 'max_tokens')
    expect((await suggest(body)).data).toMatchObject({ error: 'ai_too_long' })

    messagesReply = () => stream(text(0, 'Hier sind deine Karten!'))
    const invalid = await suggest(body)
    expect(invalid.status).toBe(502)
    expect(invalid.data.error).toBe('ai_invalid')
  })

  it('übersetzt Fehler von Anthropic in verständliche Meldungen', async () => {
    const id = await newNote('Inhalt')
    const body = { noteId: id, title: 'Inhalt', content: 'Inhalt' }
    const cases: [Reply, number, string][] = [
      [apiError(429, 'rate_limit_error', 'rate limited'), 429, 'ai_rate_limited'],
      [apiError(529, 'overloaded_error', 'overloaded'), 503, 'ai_overloaded'],
      [apiError(400, 'billing_error', 'credit balance is too low'), 402, 'ai_billing'],
      [apiError(403, 'permission_error', 'no access'), 400, 'ai_forbidden'],
      [apiError(400, 'invalid_request_error', 'This API key is not scoped to a workspace'), 400, 'ai_rejected'],
    ]
    for (const [reply, status, code] of cases) {
      messagesReply = () => reply
      const r = await suggest(body)
      expect([r.status, r.data.error], code).toEqual([status, code])
    }
    expect((await suggest(body)).data.message).toContain('not scoped to a workspace')
  })

  it('schickt keine Tresor-Notizen, keine leeren und keine zu langen Notizen', async () => {
    const vault = await suggest({ noteId: vaultNote(), title: 'Geheim', content: 'Klartext' })
    expect(vault.status).toBe(400)
    expect(vault.data.error).toBe('vault')
    // Unbekannt kann auch heißen: offline im Tresor angelegt
    const unknown = await suggest({ noteId: '99999999-2222-4333-8444-555555555555', title: 'Neu', content: 'Klartext' })
    expect([unknown.status, unknown.data.error]).toEqual([400, 'not_synced'])
    // Eine fremde Notiz ist für das Konto ebenso unbekannt
    expect((await save({ apiKey: GOOD_KEY, model: 'claude-opus-5-5' }, other)).status).toBe(200)
    const foreign = await suggest({ noteId: await newNote('Inhalt'), title: 'Fremd', content: 'Inhalt' }, other)
    expect([foreign.status, foreign.data.error]).toEqual([400, 'not_synced'])
    await call(settingsRoute.DELETE, '/api/ai/settings', { method: 'DELETE', cookie: other })

    const id = await newNote('Inhalt')
    expect((await suggest({ noteId: id, title: 'Leer', content: '  \n' })).status).toBe(400)
    const long = await suggest({ noteId: id, title: 'Lang', content: 'x'.repeat(MAX_AI_NOTE_CHARS + 1) })
    expect(long.status).toBe(400)
    expect(long.data.message).toContain('zu lang')
    // Nichts davon ging an Claude
    expect(received.filter((r) => r.path === '/v1/messages')).toEqual([])
  })

  it('meldet einen Schlüssel, der nach einem neuen SECRET_KEY nicht mehr lesbar ist', async () => {
    const id = await newNote('Inhalt')
    process.env.SECRET_KEY = 'ein-anderer-schluessel'
    try {
      const r = await suggest({ noteId: id, title: 'x', content: 'Inhalt' })
      expect([r.status, r.data.error]).toEqual([400, 'ai_key_unreadable'])
    } finally {
      process.env.SECRET_KEY = 'test-secret'
    }
    expect((await suggest({ noteId: id, title: 'x', content: 'Inhalt' })).status).toBe(200)
  })

  it('entfernt den Schlüssel auf Wunsch', async () => {
    const r = await call(settingsRoute.DELETE, '/api/ai/settings', { method: 'DELETE', cookie: token })
    expect(r.data.settings).toMatchObject({ configured: false, keyHint: null })
    expect(getDb().prepare('SELECT COUNT(*) FROM ai_settings').pluck().get()).toBe(0)
    expect(auditEvents()).toContain('ai_key_removed')
    const id = await newNote('Inhalt')
    expect((await suggest({ noteId: id, title: 'x', content: 'Inhalt' })).data.error).toBe('ai_not_configured')
  })
})
