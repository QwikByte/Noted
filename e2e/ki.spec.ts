import http from 'node:http'
import { expect, test, type Page } from '@playwright/test'
import { apiHeaders, makePdf } from './helpers'

// KI mit Claude: Schlüssel hinterlegen, Karten aus Notizen und PDFs, Assistent in Notizen und im PDF, Titel und Tags,
// Karten überarbeiten und aufteilen. Statt Anthropic antwortet ein Nachbau auf dem Port, den scripts/e2e-server.mjs
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

type Block = { type: string; text?: string }
type Body = { system: string; messages: { content: Block[] }[]; output_config?: { format?: { schema: { properties: object } } } }

/** Was der Nachbau zuletzt bekommen hat – zum Prüfen, was an Claude ging */
const received: Body[] = []

/** Antwort je nach Art der Anfrage: Karten, Titel und Tags (strukturiert) oder Text des Assistenten (gestreamt) */
function answer(body: Body): string[] {
  const props = body.output_config?.format?.schema.properties ?? {}
  const prompt = body.messages[0].content.map((b) => b.text ?? '').join('\n\n')
  if ('cards' in props) {
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
    const events = [
      { type: 'message_start', message: { ...message, stop_reason: null, usage: { input_tokens: 50, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      ...answer(body).map((text) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })),
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 40 } },
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
const cleanup: { notes: string[]; decks: string[]; attachments: string[] } = { notes: [], decks: [], attachments: [] }

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
  await page.request.delete('/api/ai/settings', { headers })
  await page.request.post('/api/auth/logout', { headers })
})
