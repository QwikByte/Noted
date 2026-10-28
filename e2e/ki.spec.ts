import http from 'node:http'
import { expect, test, type Page } from '@playwright/test'
import { apiHeaders, makePdf } from './helpers'

// KI mit Claude: Schlüssel hinterlegen, Karten aus Notizen und PDFs, Assistent in Notizen und im PDF, Titel und Tags,
// Lernen mit Bewertung und Erklärung, Problemkarten, Tutor, Probeklausur, KI-Chat, Karten überarbeiten und aufteilen.
// Statt Anthropic antwortet ein Nachbau auf dem Port, den scripts/e2e-server.mjs
// dem Server als ANTHROPIC_BASE_URL mitgibt. Räumt am Ende alles weg und meldet sich ab – app.spec.ts läuft zuerst
// und erwartet ein leeres Konto mit einer Sitzung.

const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'E2E-Admin-Passwort-1'
const ANTHROPIC_PORT = Number(process.env.E2E_ANTHROPIC_PORT ?? 3199)
const KEY = 'sk-ant-api03-e2e-schluessel-WXYZ'
const SHOTS = process.env.SCREENSHOT_DIR

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

const card = (front: string, back: string, page = 0, type = 'basic') => ({ type, front, back, options: [], page })
const NOTE_CARDS = [
  card('Was besagt der erste Hauptsatz?', 'Energie bleibt erhalten.'),
  card('In einem abgeschlossenen System nimmt die ==Entropie== nicht ab.', '', 0, 'cloze'),
]

type Block = { type: string; text?: string; tool_use_id?: string; name?: string }
type Body = {
  system: string
  messages: { role: string; content: Block[] }[]
  tools?: { name: string }[]
  output_config?: { format?: { schema: { properties: object } } }
}

/** Was der Nachbau zuletzt bekommen hat – zum Prüfen, was an Claude ging */
const received: Body[] = []

/**
 * Bewertung: je Aufgabe nach ihrer Antwort – „falsch“ darin heißt falsch, „teil“ teilweise, sonst richtig (bei
 * Aufgaben mit Punktzahl die vollen bzw. halben Punkte)
 */
function grades(prompt: string) {
  const results = [...prompt.matchAll(/<aufgabe nr="(\d+)"(?: punkte="(\d+)")?>[\s\S]*?Antwort:\n([\s\S]*?)\n<\/aufgabe>/g)].map(([, nr, max, text]) => {
    const verdict = /falsch/i.test(text) ? 'wrong' : /teil/i.test(text) ? 'partial' : 'correct'
    const full = max ? Number(max) : 1
    const points = verdict === 'correct' ? full : verdict === 'partial' ? full / 2 : 0
    const feedback = { correct: 'Passt – gleiche Aussage.', partial: 'Da fehlt noch die Begründung.', wrong: 'Leider nicht.' }[verdict]
    return { nr: Number(nr), verdict, points, feedback }
  })
  return JSON.stringify({ results })
}

const question = (q: string, a: string, points: number, topic: string) => ({ question: q, answer: a, points, topic })

/** Antwort je nach Art der Anfrage: Karten, Titel und Tags, Bewertung, Fragen (strukturiert) oder Text (gestreamt) */
function answer(body: Body): string[] {
  const props = body.output_config?.format?.schema.properties ?? {}
  const prompt = body.messages[0].content.map((b) => b.text ?? '').join('\n\n')
  if ('results' in props) return [grades(prompt)]
  if ('questions' in props) {
    if (body.system.includes('Probeklausur')) {
      return [
        JSON.stringify({
          questions: [
            question('Erläutern Sie den ersten Hauptsatz.', 'Energieerhaltung: ΔU = Q + W (4 P.)', 4, 'Hauptsätze'),
            question('Berechnen Sie $\\Delta U$ für $Q = 3$ J und $W = 2$ J.', '$\\Delta U = 5$ J (2 P.)', 2, 'Rechnen'),
          ],
        }),
      ]
    }
    return [
      JSON.stringify({
        questions: [
          question('Warum nimmt die Entropie nicht ab?', 'Weil Prozesse von selbst nur in Richtung größerer Unordnung laufen.', 1, 'Hauptsätze'),
          question('Was besagt der erste Hauptsatz?', 'Energie bleibt erhalten.', 1, 'Hauptsätze'),
        ],
      }),
    ]
  }
  if ('cards' in props) {
    if (body.system.includes('Problemkarte')) {
      return [JSON.stringify({ cards: [card('Was besagt der erste Hauptsatz?', 'Energie bleibt erhalten.\n\nMerkhilfe: Nichts geht verloren.'), card('Wofür steht ΔU?', 'Änderung der inneren Energie.')] })]
    }
    if (body.system.includes('Teile sie')) {
      return [JSON.stringify({ cards: [card('Was besagt der erste Hauptsatz?', 'Energie bleibt erhalten.'), card('Was ist innere Energie?', 'Energie der Teilchen.')] })]
    }
    if (body.system.includes('überarbeitest')) return [JSON.stringify({ cards: [card('Erster Hauptsatz – kurz?', 'ΔU = Q + W')] })]
    if (body.system.includes('Skript, ihren Folien')) return [JSON.stringify({ cards: [card('Was misst die Entropie?', 'Die Unordnung.', 1)] })]
    return [JSON.stringify({ cards: NOTE_CARDS })]
  }
  if ('title' in props) return [JSON.stringify({ title: 'Wärmelehre kompakt', tags: ['physik', 'thermodynamik'] })]
  if (!body.system.includes('neuen Text')) return ['**Entropie** ist ein Maß ', 'für die Unordnung.']
  return prompt.includes('Ausgewählter Abschnitt') ? ['Tippfehler im ', 'Satz.'] : ['# Wärme\n\n', 'Kurzer Absatz.']
}

type Stream = { blocks: Record<string, unknown>[][]; stop: string }

const textEvents = (index: number, deltas: string[]) => [
  { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
  ...deltas.map((text) => ({ type: 'content_block_delta', index, delta: { type: 'text_delta', text } })),
  { type: 'content_block_stop', index },
]
const toolEvents = (index: number, id: string, name: string, input: unknown) => [
  { type: 'content_block_start', index, content_block: { type: 'tool_use', id, name, input: {} } },
  { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } },
  { type: 'content_block_stop', index },
]

const isChat = (body: Body) => body.system.startsWith('Du bist der KI-Assistent in Noted')

/**
 * KI-Chat: je nach Frage (der letzte Text einer Nachricht mit <app-kontext>) und den Werkzeugergebnissen des Schritts –
 * Karten: Notiz lesen, Karten vorschlagen, antworten; Termin: Termin vorschlagen, antworten; sonst gleich antworten
 */
function chatAnswer(body: Body): Stream {
  const question = [...body.messages].reverse().find((m) => m.content.some((b) => b.text?.startsWith('<app-kontext>')))
  const text = question?.content.at(-1)?.text ?? ''
  const done = new Set(body.messages[body.messages.length - 1].content.map((b) => b.tool_use_id).filter(Boolean))
  if (text.includes('Karten')) {
    if (done.has('c2')) return { blocks: [textEvents(0, ['Hier sind zwei Karten aus ', '[[Chat-Notiz]].'])], stop: 'end_turn' }
    if (done.has('c1')) {
      const cards = [card('Was misst die Entropie?', 'Die Unordnung.'), card('Nimmt die Entropie ab?', 'Nein, nie.')]
      return { blocks: [toolEvents(0, 'c2', 'propose_cards', { cards, deck: 'Chat-Karten', note: 'Chat-Notiz' })], stop: 'tool_use' }
    }
    return { blocks: [toolEvents(0, 'c1', 'read_note', { note: 'Chat-Notiz' })], stop: 'tool_use' }
  }
  if (text.includes('Termin')) {
    if (done.has('e1')) return { blocks: [textEvents(0, ['Ist vorgemerkt.'])], stop: 'end_turn' }
    return { blocks: [toolEvents(0, 'e1', 'propose_event', { title: 'Lerngruppe Thermo', start: `${CHAT_DAY}T18:00`, location: 'Bib' })], stop: 'tool_use' }
  }
  return { blocks: [textEvents(0, ['Hallo!'])], stop: 'end_turn' }
}

/** Ein Tag in der kommenden Woche (Ortszeit) – für den vorgeschlagenen Termin */
const CHAT_DAY = (() => {
  const d = new Date(Date.now() + 3 * 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})()

const anthropic = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (chunk) => (raw += chunk))
  req.on('end', () => {
    if (req.url?.startsWith('/v1/models/')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ id: req.url.slice('/v1/models/'.length), type: 'model' }))
    }
    const body = JSON.parse(raw) as Body
    received.push(body)
    const message = { id: 'msg_e2e', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [] }
    const reply: Stream = isChat(body) ? chatAnswer(body) : { blocks: [textEvents(0, answer(body))], stop: 'end_turn' }
    const events = [
      { type: 'message_start', message: { ...message, stop_reason: null, usage: { input_tokens: 50, output_tokens: 1 } } },
      ...reply.blocks.flat(),
      { type: 'message_delta', delta: { stop_reason: reply.stop, stop_sequence: null }, usage: { output_tokens: 40 } },
      { type: 'message_stop' },
    ]
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
    res.end()
  })
})

test.describe.configure({ mode: 'serial' })
test.beforeAll(() => new Promise<void>((resolve) => anthropic.listen(ANTHROPIC_PORT, '127.0.0.1', resolve)))
test.afterAll(() => new Promise<void>((resolve) => anthropic.close(() => resolve())))

let consoleErrors: string[] = []
test.beforeEach(({ page }) => {
  consoleErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(String(err)))
})
test.afterEach(() => {
  expect(consoleErrors, 'Fehler in der Browser-Konsole').toEqual([])
})

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Benutzername').fill('admin')
  await page.getByLabel('Passwort', { exact: true }).fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Administrator')
}

async function newNote(page: Page, title: string, content: string) {
  const res = await page.request.post('/api/notes', { headers: await apiHeaders(page), data: { title, folderId: null, content } })
  return (await res.json()).note.id as string
}

const noteContent = (page: Page, id: string) =>
  page.evaluate((noteId) => fetch(`/api/notes/${noteId}`).then((r) => r.json()), id).then((r) => r.note.content as string)

async function openCardsFromNote(page: Page, noteId: string) {
  await page.goto(`/?n=${noteId}`)
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click()
  await page.getByRole('menuitem', { name: 'Karteikarten aus Notiz …' }).click()
  return page.getByRole('dialog', { name: 'Karteikarten aus Notiz' })
}

/** Alles, was die Tests angelegt haben – am Ende gelöscht */
const cleanup: { notes: string[]; decks: string[]; attachments: string[]; events: string[] } = { notes: [], decks: [], attachments: [], events: [] }

test('Schlüssel hinterlegen und Karten aus einer Notiz vorschlagen lassen', async ({ page }) => {
  await login(page)
  const noteId = await newNote(page, 'Wärmelehre', '# Hauptsätze\nEnergie bleibt erhalten, die Entropie nimmt nicht ab.')
  cleanup.notes.push(noteId)

  // Ohne Schlüssel: nur ein Hinweis, der zu den Einstellungen führt
  let dialog = await openCardsFromNote(page, noteId)
  await expect(dialog.getByText('Karten von Claude vorschlagen lassen:')).toBeVisible()
  await dialog.getByRole('link', { name: 'Einstellungen → KI' }).click()
  await expect(page).toHaveURL(/\/settings#ki$/)

  const section = page.locator('#ki')
  await section.getByLabel('API-Schlüssel').fill(KEY)
  await section.getByLabel('Modell').selectOption('claude-sonnet-5-5')
  await section.getByRole('button', { name: 'Prüfen und speichern' }).click()
  await expect(page.getByText('Schlüssel gespeichert – Claude ist bereit.')).toBeVisible()
  await expect(section.getByText('Aktiv')).toBeVisible()
  await expect(section.getByText('…WXYZ')).toBeVisible()
  await expect(section.getByLabel('Modell')).toHaveValue('claude-sonnet-5-5')
  await section.scrollIntoViewIfNeeded()
  await shot(page, '70-ai-settings')

  dialog = await openCardsFromNote(page, noteId)
  const ai = dialog.getByTestId('ai-cards')
  await expect(ai).toContainText('Claude Sonnet 5.5')
  await ai.getByLabel('Wünsche an Claude (optional)').fill('nur das Wichtigste')
  await ai.getByRole('button', { name: 'Karten vorschlagen' }).click()
  await expect(dialog.getByText('Von Claude vorgeschlagen')).toBeVisible()
  await expect(dialog.getByText('Was besagt der erste Hauptsatz?')).toBeVisible()
  await shot(page, '71-ai-cards-from-note')
  const prompt = received.at(-1)!.messages[0].content.map((b) => b.text).join('\n')
  expect(prompt).toContain('Energie bleibt erhalten')
  expect(prompt).toContain('Wünsche zu den Karten: nur das Wichtigste')

  await dialog.getByLabel('In Stapel').selectOption('__new__')
  await dialog.getByLabel('Name des neuen Stapels').fill('Wärmelehre mit Claude')
  await dialog.getByTestId('create-from-note').click()
  await expect(page.getByText('2 Karten erstellt.')).toBeVisible()

  const data = await page.evaluate(() => fetch('/api/flashcards').then((r) => r.json()))
  const deck = (data.decks as { id: string; name: string }[]).find((d) => d.name === 'Wärmelehre mit Claude')!
  cleanup.decks.push(deck.id)
  const cards = (data.cards as { deckId: string; front: string; noteId: string | null }[]).filter((c) => c.deckId === deck.id)
  expect(cards.map((c) => [c.front, c.noteId])).toEqual(NOTE_CARDS.map((c) => [c.front, noteId]))
})

test('Assistent ändert die ganze Notiz oder eine Markierung – mit Vorschau, Vergleich und Rückgängig', async ({ page }) => {
  await login(page)
  const noteId = await newNote(page, 'Wärme', '---\ntags: [physik]\n---\n# Wärme\n\nEin sehr langer Absatz über Wärme.\n\nTipfehler im Satz.\n')
  cleanup.notes.push(noteId)
  await page.goto(`/?n=${noteId}`)
  await page.getByRole('radio', { name: 'Bearbeiten' }).click()
  const editor = page.locator('.cm-content')

  // Ganze Notiz über die Werkzeugleiste – die Properties bleiben stehen
  await page.getByRole('button', { name: 'KI-Assistent (Strg+J)' }).click()
  let dialog = page.getByRole('dialog', { name: 'KI-Assistent' })
  await expect(dialog.getByText('Bereich: Ganze Notiz')).toBeVisible()
  await dialog.getByRole('button', { name: 'Kürzen', exact: true }).click()
  await expect(dialog.getByTestId('ai-result')).toContainText('Kurzer Absatz.')
  await shot(page, '72-ai-assistant')
  await dialog.getByTestId('ai-replace').click()
  await expect(page.getByText('Übernommen – Strg+Z macht es rückgängig.')).toBeVisible()
  await expect(editor).toContainText('Kurzer Absatz.')
  await expect(editor).not.toContainText('Tipfehler')
  await expect.poll(() => noteContent(page, noteId)).toBe('---\ntags: [physik]\n---\n# Wärme\n\nKurzer Absatz.')

  // Rückgängig holt den alten Text zurück
  await editor.click()
  await page.keyboard.press('Control+z')
  await expect(editor).toContainText('Ein sehr langer Absatz über Wärme.')
  await expect.poll(() => noteContent(page, noteId)).toContain('Tipfehler im Satz.')

  // Markierung mit Strg+J: nur sie wird ersetzt
  await page.locator('.cm-line', { hasText: 'Tipfehler im Satz.' }).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Shift+Home')
  await page.keyboard.press('Control+j')
  dialog = page.getByRole('dialog', { name: 'KI-Assistent' })
  await expect(dialog.getByRole('radio', { name: 'Markierung' })).toBeChecked()
  await dialog.getByRole('button', { name: 'Korrigieren' }).click()
  await expect(dialog.getByTestId('ai-result')).toContainText('Tippfehler im Satz.')
  await dialog.getByRole('radio', { name: 'Vergleich' }).click()
  await expect(dialog.getByTestId('diff-view')).toContainText('Tipfehler im Satz.')
  const prompt = received.at(-1)!.messages[0].content.map((b) => b.text).join('\n')
  expect(prompt).toContain('Ausgewählter Abschnitt:\n<text>\nTipfehler im Satz.\n</text>')
  await dialog.getByTestId('ai-replace').click()
  await expect
    .poll(() => noteContent(page, noteId))
    .toBe('---\ntags: [physik]\n---\n# Wärme\n\nEin sehr langer Absatz über Wärme.\n\nTippfehler im Satz.\n')

  // Titel und Tags vorschlagen: Titel und neue Tags übernehmen, vorhandene bleiben
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click()
  await page.getByRole('menuitem', { name: 'Titel und Tags vorschlagen …' }).click()
  dialog = page.getByRole('dialog', { name: 'Titel und Tags vorschlagen' })
  await expect(dialog.getByLabel('Neuer Titel')).toHaveValue('Wärmelehre kompakt')
  await expect(dialog.getByLabel('#thermodynamik')).toBeChecked()
  await expect(dialog.getByLabel('#physik')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Übernehmen' }).click()
  await expect(page.getByTestId('note-title')).toHaveValue('Wärmelehre kompakt')
  await expect.poll(() => noteContent(page, noteId)).toContain('tags: [ physik, thermodynamik ]')
})

test('PDF: Seite erklären lassen, in die Notiz einfügen und Karten aus der Seite', async ({ page }) => {
  await login(page)
  const headers = await apiHeaders(page)
  const up = await page.request.post('/api/attachments', {
    headers,
    multipart: {
      file: { name: 'Skript Entropie.pdf', mimeType: 'application/pdf', buffer: makePdf([['Entropie', 'Ein Maß für die Unordnung.']]) },
    },
  })
  cleanup.attachments.push((await up.json()).attachment.id)
  const noteId = await newNote(page, 'Entropie', 'Skript: ![[Skript Entropie.pdf]]\n')
  cleanup.notes.push(noteId)
  await page.goto(`/?n=${noteId}`)
  await page.getByRole('radio', { name: 'Lesen' }).click()
  await page.locator('.markdown-body a.embed-pdf').click()
  const panel = page.getByTestId('pdf-panel')
  await expect(panel.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 15_000 })

  // Seite erklären: startet sofort, das Bild der Seite geht mit
  await panel.getByRole('button', { name: 'Weitere PDF-Aktionen' }).click()
  await page.getByRole('menuitem', { name: 'Seite 1 mit KI erklären' }).click()
  let dialog = page.getByRole('dialog', { name: 'KI-Assistent' })
  await expect(dialog.getByTestId('ai-result')).toContainText('ist ein Maß für die Unordnung.')
  expect(received.at(-1)!.messages[0].content.some((b) => b.type === 'image')).toBe(true)
  await dialog.getByRole('button', { name: 'In „Entropie“ einfügen' }).click()
  await expect.poll(() => noteContent(page, noteId)).toContain('**Entropie** ist ein Maß für die Unordnung.')
  await expect.poll(() => noteContent(page, noteId)).toContain('[[Skript Entropie.pdf#page=1|S. 1]]')

  // Karten aus der Seite: mit Seitenlink auf der Rückseite
  await panel.getByRole('button', { name: 'Weitere PDF-Aktionen' }).click()
  await page.getByRole('menuitem', { name: 'Karteikarten mit KI …' }).click()
  dialog = page.getByRole('dialog', { name: 'Karteikarten mit KI' })
  await expect(dialog.getByLabel('Seiten')).toHaveValue('1')
  await dialog.getByRole('button', { name: 'Karten vorschlagen' }).click()
  const list = dialog.getByTestId('ai-card-list')
  await expect(list).toContainText('Was misst die Entropie?')
  await expect(list).toContainText('S. 1')
  await shot(page, '73-ai-pdf-cards')
  await dialog.getByLabel('In Stapel').selectOption('__new__')
  await dialog.getByLabel('Name des neuen Stapels').fill('Entropie mit Claude')
  await dialog.getByTestId('ai-create-cards').click()
  await expect(page.getByText('1 Karte erstellt.')).toBeVisible()
  const data = await page.evaluate(() => fetch('/api/flashcards').then((r) => r.json()))
  const deck = (data.decks as { id: string; name: string }[]).find((d) => d.name === 'Entropie mit Claude')!
  cleanup.decks.push(deck.id)
  const made = (data.cards as { deckId: string; back: string; noteId: string | null }[]).filter((c) => c.deckId === deck.id)
  expect(made).toMatchObject([{ back: 'Die Unordnung.\n\n[[Skript Entropie.pdf#page=1|Skript Entropie, S. 1]]', noteId }])
})

const DAY = 86_400_000
/** 1×1-Pixel-PNG als „Foto“ einer handschriftlichen Lösung */
const PHOTO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const lastPrompt = () => received.at(-1)!.messages[0].content.map((b) => b.text ?? '[Bild]').join('\n')

test('Lernen: Claude prüft die eingetippte Antwort und erklärt die Karte, Problemkarten überarbeiten', async ({ page }) => {
  await login(page)
  const headers = await apiHeaders(page)
  const noteId = await newNote(page, 'Hauptsätze', '# Hauptsätze\nEnergie bleibt erhalten, die Entropie nimmt nicht ab.')
  cleanup.notes.push(noteId)
  const deck = (await (await page.request.post('/api/decks', { headers, data: { name: 'Thermo tippen', typeAnswer: true } })).json()).deck
  cleanup.decks.push(deck.id)
  const [typedCard] = (
    await (
      await page.request.post(`/api/decks/${deck.id}/cards`, {
        headers,
        data: { cards: [{ type: 'basic', front: 'Was besagt der erste Hauptsatz?', back: 'Energie bleibt erhalten.', noteId }] },
      })
    ).json()
  ).cards

  // Nicht Zeichen für Zeichen richtig – Claude erkennt die gleiche Aussage und wählt „Gut“ vor
  await page.goto(`/?s=deck:${deck.id}`)
  const input = page.getByTestId('typed-answer')
  await input.fill('Die Energie bleibt immer gleich')
  await input.press('Enter')
  await expect(page.getByTestId('typed-result')).toContainText('Nicht ganz')
  const verdict = page.getByTestId('ai-verdict')
  await expect(verdict).toContainText('Richtig')
  await expect(verdict).toContainText('Passt – gleiche Aussage.')
  await expect(page.getByTestId('rate-3')).toHaveClass(/ring-accent/)
  expect(lastPrompt()).toContain('Musterlösung:\nEnergie bleibt erhalten.\n\nAntwort:\nDie Energie bleibt immer gleich')
  await shot(page, '74-ai-typed-answer')

  // Erklären: mit der Notiz als Hintergrund
  await page.getByTestId('ai-explain-card').click()
  const dialog = page.getByRole('dialog', { name: 'KI-Assistent' })
  await expect(dialog.getByTestId('ai-result')).toContainText('ist ein Maß für die Unordnung.')
  expect(lastPrompt()).toContain('Frage:\nWas besagt der erste Hauptsatz?')
  expect(lastPrompt()).toContain('<kontext>\n# Hauptsätze\nEnergie bleibt erhalten')
  await dialog.getByRole('button', { name: 'Verwerfen' }).click()
  await page.getByTestId('rate-3').click()
  await expect
    .poll(async () => {
      const { reviews } = await page.evaluate(() => fetch('/api/flashcards').then((r) => r.json()))
      return (reviews as { cardId: string; step: number }[]).find((r) => r.cardId === typedCard.id)?.step
    })
    .toBe(1)

  // Problemkarte: Claude schlägt zwei leichter merkbare Karten vor – die erste ersetzt sie, gelernt wird neu
  const leeches = (await (await page.request.post('/api/decks', { headers, data: { name: 'Problemfälle mit Claude' } })).json()).deck
  cleanup.decks.push(leeches.id)
  const [hard] = (
    await (
      await page.request.post(`/api/decks/${leeches.id}/cards`, {
        headers,
        data: { cards: [{ type: 'basic', front: 'Erkläre alle Hauptsätze mit Formeln', back: 'Sehr viel Text …', noteId }] },
      })
    ).json()
  ).cards
  const now = Date.now()
  await page.request.post('/api/reviews', {
    headers,
    data: {
      reviews: [
        { cardId: hard.id, side: 0, phase: 'review', step: 0, interval: 1, ease: 1.3, reps: 12, lapses: 7, due: now - 60_000, reviewedAt: now - DAY, introducedAt: now - 30 * DAY },
      ],
    },
  })
  await page.goto(`/?d=${leeches.id}`)
  await page.getByRole('radiogroup', { name: 'Karten filtern' }).getByRole('radio', { name: /Problemkarten/ }).click()
  await page.getByTestId('problem-hint').getByRole('button', { name: 'Mit KI überarbeiten …' }).click()
  const problems = page.getByRole('dialog', { name: 'Problemkarten mit KI überarbeiten' })
  await expect(problems.getByTestId('ai-problem-card')).toContainText('Merkhilfe: Nichts geht verloren.')
  await expect(problems.getByTestId('ai-problem-card')).toContainText('Wofür steht ΔU?')
  expect(received.at(-1)!.system).toContain('Problemkarte')
  await shot(page, '75-ai-problem-cards')
  await problems.getByTestId('ai-problem-apply-all').click()
  await expect(page.getByText('1 Karte überarbeitet.')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(problems).toBeHidden()
  const data = await page.evaluate(() => fetch('/api/flashcards').then((r) => r.json()))
  const cards = (data.cards as { id: string; deckId: string; front: string; noteId: string | null; suspended: boolean }[]).filter(
    (c) => c.deckId === leeches.id,
  )
  expect(cards.map((c) => [c.front, c.noteId])).toEqual([
    ['Was besagt der erste Hauptsatz?', noteId],
    ['Wofür steht ΔU?', noteId],
  ])
  expect((data.reviews as { cardId: string }[]).some((r) => r.cardId === hard.id)).toBe(false)
})

test('Tutor: Claude fragt eine Notiz ab und bewertet die Antworten', async ({ page }) => {
  await login(page)
  const noteId = await newNote(page, 'Wärmelehre Tutor', '# Hauptsätze\nEnergie bleibt erhalten, die Entropie nimmt nicht ab.')
  cleanup.notes.push(noteId)
  await page.goto(`/?n=${noteId}`)
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click()
  await page.getByRole('menuitem', { name: 'Mit KI abfragen' }).click()

  const tutor = page.getByTestId('ai-tutor')
  await expect(tutor.getByTestId('ai-tutor-card')).toContainText('Warum nimmt die Entropie nicht ab?')
  expect(received.at(-1)!.system).toContain('Höchstens 8 Fragen')
  await tutor.getByTestId('ai-tutor-answer').fill('Weiß ich nur teilweise: wegen der Unordnung')
  await tutor.getByTestId('ai-tutor-answer').press('Control+Enter')
  await expect(tutor.getByTestId('ai-verdict')).toContainText('Teilweise richtig')
  await expect(tutor.getByTestId('ai-tutor-solution')).toContainText('größerer Unordnung')
  // Der passende Abschnitt der Notiz geht als Zusammenhang mit
  expect(lastPrompt()).toContain('<kontext>\nHauptsätze\nEnergie bleibt erhalten')
  await shot(page, '76-ai-tutor')
  await tutor.getByTestId('ai-tutor-next').click()

  await expect(tutor.getByTestId('ai-tutor-card')).toContainText('Was besagt der erste Hauptsatz?')
  await tutor.getByRole('button', { name: 'Weiß ich nicht' }).click()
  await expect(tutor.getByTestId('ai-tutor-solution')).toContainText('Energie bleibt erhalten.')
  await tutor.getByTestId('ai-tutor-next').click()

  const done = tutor.getByTestId('ai-tutor-done')
  await expect(done).toContainText('Richtig: 0 · Teilweise: 1 · Falsch: 1')
  await done.getByRole('button', { name: 'Karteikarten aus den Lücken' }).click()
  const fromNote = page.getByRole('dialog', { name: 'Karteikarten aus Notiz' })
  await expect(fromNote).toBeVisible()
  await fromNote.getByRole('button', { name: 'Abbrechen' }).click()
})

test('Probeklausur: erstellen, mit Text und Foto beantworten, korrigieren lassen und als Notiz speichern', async ({ page }) => {
  await login(page)
  const headers = await apiHeaders(page)
  const deck = (await (await page.request.post('/api/decks', { headers, data: { name: 'Thermo-Klausur' } })).json()).deck
  cleanup.decks.push(deck.id)
  await page.request.post(`/api/decks/${deck.id}/cards`, {
    headers,
    data: { cards: [{ type: 'basic', front: 'Was besagt der erste Hauptsatz?', back: 'Energie bleibt erhalten.' }] },
  })
  await page.goto(`/?d=${deck.id}`)
  await page.getByRole('button', { name: 'Stapel-Aktionen' }).click()
  await page.getByRole('menuitem', { name: 'Probeklausur mit KI …' }).click()

  const exam = page.getByTestId('mock-exam')
  await exam.getByRole('radio', { name: '5 Aufgaben', exact: true }).click()
  await exam.getByLabel('Wünsche an Claude (optional)').fill('mit Rechnung')
  await exam.getByTestId('mock-exam-start').click()
  const tasks = exam.getByTestId('mock-exam-task')
  await expect(tasks).toHaveCount(2)
  expect(received.at(-1)!.system).toContain('Genau 5 Aufgaben')
  expect(lastPrompt()).toContain('<karte>\nWas besagt der erste Hauptsatz?\n→ Energie bleibt erhalten.\n</karte>')
  await expect(exam).toContainText('6 Punkte')

  await tasks.nth(0).getByLabel('Antwort auf Aufgabe 1').fill('Energie bleibt erhalten: ΔU = Q + W')
  await tasks.nth(1).getByLabel('Antwort auf Aufgabe 2').fill('Nur teilweise gerechnet, siehe Foto')
  await tasks.nth(1).getByTestId('mock-exam-photo-input').setInputFiles({ name: 'loesung.png', mimeType: 'image/png', buffer: PHOTO })
  await expect(tasks.nth(1).getByRole('img', { name: 'Foto 1 zu Aufgabe 2' })).toBeVisible()
  await shot(page, '77-ai-mock-exam')

  // Antworten und Foto überstehen das Neuladen
  await page.reload()
  await expect(tasks.nth(0).getByLabel('Antwort auf Aufgabe 1')).toHaveValue('Energie bleibt erhalten: ΔU = Q + W')
  await expect(tasks.nth(1).getByRole('img', { name: 'Foto 1 zu Aufgabe 2' })).toBeVisible()

  await exam.getByTestId('mock-exam-submit').click()
  await expect(exam.getByTestId('mock-exam-score')).toContainText('5 von 6 Punkten')
  await expect(exam.getByTestId('mock-exam-score')).toContainText('83 %')
  await expect(exam.getByTestId('mock-exam-result').nth(1)).toContainText('Teilweise richtig')
  const grading = received.at(-1)!
  expect(grading.messages[0].content.filter((b) => b.type === 'image')).toHaveLength(1)
  expect(lastPrompt()).toContain('<aufgabe nr="1" punkte="4">')
  await shot(page, '78-ai-mock-exam-result')

  await exam.getByRole('button', { name: 'Als Notiz speichern' }).click()
  await expect(page).toHaveURL(/\?n=/)
  const savedId = new URL(page.url()).searchParams.get('n')!
  cleanup.notes.push(savedId)
  // Über den Server, nicht im Browser – solange die Notiz noch nicht synchronisiert ist, gibt es 404
  const saved = async () => {
    const res = await page.request.get(`/api/notes/${savedId}`)
    return res.ok() ? ((await res.json()).note.content as string) : ''
  }
  await expect.poll(saved).toContain('# Probeklausur: Thermo-Klausur')
  expect(await saved()).toContain('**Bewertung:** Teilweise richtig – Da fehlt noch die Begründung.')
})

test('KI-Chat: liest Notizen, schlägt Karten und Termine vor – im Fenster und im Vollbild', async ({ page }) => {
  await login(page)
  const noteId = await newNote(page, 'Chat-Notiz', '# Entropie\nDie Entropie misst die Unordnung und nimmt nie ab.')
  cleanup.notes.push(noteId)
  await page.goto(`/?n=${noteId}`)
  await expect(page.getByTestId('note-title')).toHaveValue('Chat-Notiz')
  const before = received.length

  // Alt+K öffnet den Chat in der Werkzeugleiste – die offene Notiz ist als Bezug dabei
  await page.keyboard.press('Alt+KeyK')
  const win = page.getByTestId('window-chat')
  const chat = win.getByTestId('ai-chat')
  await expect(chat.getByText('Notiz „Chat-Notiz“')).toBeVisible()
  const input = chat.getByLabel('Nachricht an Claude')
  await expect(input).toBeFocused()
  await input.fill('Mach mir Karten zur Notiz')
  await input.press('Enter')

  let answer = chat.getByTestId('ai-chat-answer').last()
  await expect(answer).toContainText('Hier sind zwei Karten aus')
  await expect(answer.getByTestId('ai-chat-tool').first()).toContainText('Liest „Chat-Notiz“')
  await expect(answer.getByRole('link', { name: 'Chat-Notiz' })).toBeVisible()
  const cards = answer.getByTestId('chat-proposal')
  await expect(cards).toContainText('Was misst die Entropie?')
  await expect(cards.getByLabel('Name des neuen Stapels')).toHaveValue('Chat-Karten')
  const firstChat = received.slice(before).find(isChat)!
  // Websuche ist voreingestellt an; der Bezug geht als Angabe der App mit
  expect(firstChat.tools?.map((t) => t.name)).toContain('web_search')
  expect(firstChat.messages[0].content[0].text).toContain('Gerade geöffnet: Notiz „Chat-Notiz“')
  await shot(page, '79-ai-chat')
  await cards.getByRole('button', { name: '2 Karten erstellen' }).click()
  await expect(cards).toContainText('2 Karten in „Chat-Karten“ erstellt.')
  const data = await page.evaluate(() => fetch('/api/flashcards').then((r) => r.json()))
  const deck = (data.decks as { id: string; name: string }[]).find((d) => d.name === 'Chat-Karten')!
  cleanup.decks.push(deck.id)
  const made = (data.cards as { deckId: string; front: string; noteId: string | null }[]).filter((c) => c.deckId === deck.id)
  expect(made.map((c) => [c.front, c.noteId])).toEqual([
    ['Was misst die Entropie?', noteId],
    ['Nimmt die Entropie ab?', noteId],
  ])

  // Vollbild; die zweite Frage bekommt den Verlauf mit
  await win.getByRole('button', { name: 'Vollbild' }).click()
  await expect(win).toHaveAttribute('data-maximized', 'true')
  await input.fill('Trag mir einen Termin für die Lerngruppe ein')
  await input.press('Enter')
  answer = chat.getByTestId('ai-chat-answer').last()
  const event = answer.getByTestId('chat-proposal')
  await expect(event).toContainText('Lerngruppe Thermo')
  await expect(answer).toContainText('Ist vorgemerkt.')
  await shot(page, '80-ai-chat-full')
  expect(received.filter(isChat).at(-1)!.messages.length).toBeGreaterThan(6)
  await event.getByRole('button', { name: 'Eintragen' }).click()
  await expect(event).toContainText('Im Kalender eingetragen.')
  const { events } = await (await page.request.get('/api/calendar')).json()
  const created = (events as { id: string; title: string; start: string; location: string }[]).find((e) => e.title === 'Lerngruppe Thermo')!
  cleanup.events.push(created.id)
  expect(created).toMatchObject({ start: `${CHAT_DAY}T18:00`, location: 'Bib' })

  // Antwort als Notiz – der Chat bleibt offen
  await win.getByRole('button', { name: 'Vollbild' }).click()
  await expect(win).not.toHaveAttribute('data-maximized')
  await answer.getByRole('button', { name: 'Als Notiz' }).click()
  await expect(page.getByTestId('note-title')).toHaveValue('KI-Chat – Trag mir einen Termin für die Lerngruppe ein')
  cleanup.notes.push(new URL(page.url()).searchParams.get('n')!)
  await expect(chat.getByTestId('ai-chat-turn')).toHaveCount(2)

  // Neuer Chat: nichts gespeichert, alles weg
  await win.getByRole('button', { name: 'Neuer Chat' }).click()
  await expect(chat.getByTestId('ai-chat-turn')).toHaveCount(0)
})

test('Karte mit KI überarbeiten und aufteilen', async ({ page }) => {
  await login(page)
  const headers = await apiHeaders(page)
  const deckRes = await page.request.post('/api/decks', { headers, data: { name: 'Thermo-Probleme' } })
  const deckId = (await deckRes.json()).deck.id as string
  cleanup.decks.push(deckId)
  await page.request.post(`/api/decks/${deckId}/cards`, {
    headers,
    data: { cards: [{ type: 'basic', front: 'Nenne die Hauptsätze und erkläre sie', back: 'Viel Text …' }] },
  })
  await page.goto(`/?d=${deckId}`)

  // Überarbeiten im Karteneditor – erst „Übernehmen“, dann „Speichern“
  await page.getByRole('button', { name: 'Karte bearbeiten' }).click()
  let dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Mit KI überarbeiten' }).click()
  await dialog.getByTestId('ai-card-improve').getByRole('button', { name: 'Vorschlagen' }).click()
  await expect(dialog.getByTestId('ai-card-improve')).toContainText('Erster Hauptsatz – kurz?')
  await dialog.getByRole('button', { name: 'Übernehmen' }).click()
  await expect(dialog.getByTestId('card-front')).toHaveValue('Erster Hauptsatz – kurz?')
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click()
  await expect(page.getByText('Erster Hauptsatz – kurz?')).toBeVisible()

  // Aufteilen: Vorschläge kommen sofort, die bisherige Karte wird ausgesetzt
  await page.getByRole('button', { name: 'Weitere Aktionen' }).first().click()
  await page.getByRole('menuitem', { name: 'Mit KI aufteilen …' }).click()
  dialog = page.getByRole('dialog', { name: 'Karteikarten mit KI' })
  await expect(dialog.getByTestId('ai-card-list')).toContainText('Was ist innere Energie?')
  await expect(dialog.getByLabel('Die bisherige Karte aussetzen')).toBeChecked()
  await dialog.getByTestId('ai-create-cards').click()
  await expect(page.getByText('2 Karten erstellt.')).toBeVisible()
  const data = await page.evaluate(() => fetch('/api/flashcards').then((r) => r.json()))
  const cards = (data.cards as { deckId: string; front: string; suspended: boolean }[]).filter((c) => c.deckId === deckId)
  expect(cards.map((c) => [c.front, c.suspended])).toEqual([
    ['Erster Hauptsatz – kurz?', true],
    ['Was besagt der erste Hauptsatz?', false],
    ['Was ist innere Energie?', false],
  ])

  // Aufräumen
  for (const id of cleanup.decks) await page.request.delete(`/api/decks/${id}`, { headers })
  for (const id of cleanup.notes) await page.request.delete(`/api/notes/${id}?permanent=1`, { headers })
  for (const id of cleanup.attachments) await page.request.delete(`/api/attachments/${id}`, { headers })
  for (const id of cleanup.events) await page.request.delete(`/api/calendar/${id}`, { headers })
  await page.request.delete('/api/ai/settings', { headers })
  await page.request.post('/api/auth/logout', { headers })
})
