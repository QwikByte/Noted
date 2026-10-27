import http from 'node:http'
import { expect, test, type Page } from '@playwright/test'
import { apiHeaders } from './helpers'

// KI mit Claude: Schlüssel hinterlegen und Karteikarten aus einer Notiz vorschlagen lassen. Statt Anthropic antwortet
// ein Nachbau auf dem Port, den scripts/e2e-server.mjs dem Server als ANTHROPIC_BASE_URL mitgibt. Räumt am Ende alles
// weg und meldet sich ab – app.spec.ts läuft zuerst und erwartet ein leeres Konto mit einer Sitzung.

const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'E2E-Admin-Passwort-1'
const ANTHROPIC_PORT = Number(process.env.E2E_ANTHROPIC_PORT ?? 3199)
const KEY = 'sk-ant-api03-e2e-schluessel-WXYZ'
const SHOTS = process.env.SCREENSHOT_DIR

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

const CARDS = [
  { type: 'basic', front: 'Was besagt der erste Hauptsatz?', back: 'Energie bleibt erhalten.', options: [] },
  { type: 'cloze', front: 'In einem abgeschlossenen System nimmt die ==Entropie== nicht ab.', back: '', options: [] },
]

let prompt = ''
const anthropic = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (chunk) => (raw += chunk))
  req.on('end', () => {
    if (req.url?.startsWith('/v1/models/')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ id: req.url.slice('/v1/models/'.length), type: 'model' }))
    }
    prompt = JSON.parse(raw).messages[0].content
    const message = { id: 'msg_e2e', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [] }
    const events = [
      { type: 'message_start', message: { ...message, stop_reason: null, usage: { input_tokens: 50, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: JSON.stringify({ cards: CARDS }) } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 40 } },
      { type: 'message_stop' },
    ]
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
    res.end()
  })
})

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

async function openCardsFromNote(page: Page, noteId: string) {
  await page.goto(`/?n=${noteId}`)
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click()
  await page.getByRole('menuitem', { name: 'Karteikarten aus Notiz …' }).click()
  return page.getByRole('dialog', { name: 'Karteikarten aus Notiz' })
}

test('Schlüssel hinterlegen und Karten von Claude vorschlagen lassen', async ({ page }) => {
  await login(page)
  const headers = await apiHeaders(page)
  const res = await page.request.post('/api/notes', {
    headers,
    data: { title: 'Wärmelehre', folderId: null, content: '# Hauptsätze\nEnergie bleibt erhalten, die Entropie nimmt nicht ab.' },
  })
  const noteId = (await res.json()).note.id as string

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
  await expect(section.getByLabel('API-Schlüssel')).toHaveCount(0)
  await section.scrollIntoViewIfNeeded()
  await shot(page, '70-ai-settings')

  dialog = await openCardsFromNote(page, noteId)
  const ai = dialog.getByTestId('ai-cards')
  await expect(ai).toContainText('Claude Sonnet 5.5')
  await ai.getByLabel('Wünsche an Claude (optional)').fill('nur das Wichtigste')
  await ai.getByRole('button', { name: 'Karten vorschlagen' }).click()
  await expect(dialog.getByText('Von Claude vorgeschlagen')).toBeVisible()
  await expect(dialog.getByText('Was besagt der erste Hauptsatz?')).toBeVisible()
  await expect(ai.getByRole('button', { name: 'Neu vorschlagen' })).toBeVisible()
  await shot(page, '71-ai-cards-from-note')
  expect(prompt).toContain('Energie bleibt erhalten')
  expect(prompt).toContain('Wünsche zu den Karten: nur das Wichtigste')

  await dialog.getByLabel('In Stapel').selectOption('__new__')
  await dialog.getByLabel('Name des neuen Stapels').fill('Wärmelehre mit Claude')
  await dialog.getByTestId('create-from-note').click()
  await expect(page.getByText('2 Karten erstellt.')).toBeVisible()

  const data = await page.evaluate(() => fetch('/api/flashcards').then((r) => r.json()))
  const deck = (data.decks as { id: string; name: string }[]).find((d) => d.name === 'Wärmelehre mit Claude')!
  const cards = (data.cards as { deckId: string; front: string; noteId: string | null }[]).filter((c) => c.deckId === deck.id)
  expect(cards.map((c) => [c.front, c.noteId])).toEqual(CARDS.map((c) => [c.front, noteId]))

  await page.request.delete(`/api/decks/${deck.id}`, { headers })
  await page.request.delete(`/api/notes/${noteId}?permanent=1`, { headers })
  await page.request.delete('/api/ai/settings', { headers })
  await page.request.post('/api/auth/logout', { headers })
})
