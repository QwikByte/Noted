import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { ADMIN_PASSWORD, call, loginAs, setupTestEnv } from '@/tests/helpers'
import * as settingsRoute from '@/app/api/ai/settings/route'
import * as cardsRoute from '@/app/api/ai/cards/route'
import * as assistRoute from '@/app/api/ai/assist/route'
import * as metaRoute from '@/app/api/ai/meta/route'
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
