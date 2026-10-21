import { expect, test, type Page } from '@playwright/test'
import { apiHeaders, makePdf } from './helpers'

// Formate einer Notiz: formatierter Text wie in Word, einfacher Text und das Umwandeln zwischen den Formaten.

const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'E2E-Admin-Passwort-1'
const SHOTS = process.env.SCREENSHOT_DIR

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Benutzername').fill('admin')
  await page.getByLabel('Passwort', { exact: true }).fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Administrator')
}

async function newNote(page: Page, format: RegExp, title: string) {
  await page.getByRole('button', { name: 'Neue Notiz' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('radio', { name: format }).click()
  await dialog.getByLabel(/Titel/).fill(title)
  await dialog.getByRole('button', { name: 'Erstellen' }).click()
  await expect(page.getByTestId('note-title')).toHaveValue(title)
}

const savedContent = (page: Page, id: string) =>
  page.evaluate((noteId) => fetch(`/api/notes/${noteId}`).then((r) => r.json()), id).then((r) => r.note as { content: string; format: string })

test.describe.configure({ mode: 'serial' })

let consoleErrors: string[] = []
test.beforeEach(({ page }) => {
  consoleErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/status of (401|403|404|409)/.test(msg.text())) consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(String(err)))
})
test.afterEach(() => {
  expect(consoleErrors, 'Fehler in der Browser-Konsole').toEqual([])
})

test('Formatierter Text: schreiben wie in Word, Seitenlink aus dem PDF, Lesemodus und Umwandeln in Markdown', async ({ page }) => {
  await login(page)
  const up = await page.request.post('/api/attachments', {
    headers: await apiHeaders(page),
    multipart: { file: { name: 'Folien.pdf', mimeType: 'application/pdf', buffer: makePdf([['Folie 1', 'Einleitung']]) } },
  })
  expect(up.status()).toBe(201)

  await newNote(page, /Formatierter Text/, 'Protokoll')
  const editor = page.getByTestId('rich-editor')
  await expect(editor).toBeVisible()
  // Werkzeugleiste ist sofort da, nicht erst nach der ersten Eingabe
  await expect(page.getByRole('button', { name: 'Fett (Strg+B)' })).toBeVisible()
  const id = new URL(page.url()).searchParams.get('n')!

  // Überschrift über das Absatzformat, dann Text mit Fett und Farbe
  await editor.click()
  // Die Werkzeugleiste nimmt dem Editor den Fokus nie weg – auch nicht beim Auswählen im Menü. Sonst geht verloren,
  // was direkt danach getippt wird, bis TipTap den Fokus im nächsten Frame zurückholt.
  type Watched = { __editorBlurred?: boolean }
  await editor.evaluate((el) => el.addEventListener('blur', () => ((window as Watched).__editorBlurred = true)))
  await page.getByRole('button', { name: 'Absatzformat' }).click()
  await page.getByRole('menuitem', { name: 'Überschrift 2' }).click()
  await page.keyboard.type('Sitzung vom Montag')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Das ist ')
  await page.keyboard.press('Control+b')
  await page.keyboard.type('wichtig')
  await page.keyboard.press('Control+b')
  await page.keyboard.type(' und ')
  await page.getByRole('button', { name: 'Schriftfarbe' }).click()
  await page.getByRole('menuitem', { name: 'Rot' }).click()
  await page.keyboard.type('rot')
  expect(await page.evaluate(() => (window as Watched).__editorBlurred), 'Editor hat den Fokus verloren').toBeUndefined()
  await expect(editor.locator('h2')).toHaveText('Sitzung vom Montag')
  await expect(editor.locator('strong')).toHaveText('wichtig')
  await expect(editor.locator('span[style*="color"]')).toHaveText('rot')

  // Seitenlink aus dem PDF-Viewer landet als Link im formatierten Text
  await page.getByRole('button', { name: 'PDF daneben öffnen' }).click()
  await page.getByRole('menuitem', { name: 'Folien.pdf' }).click()
  const panel = page.getByTestId('pdf-panel')
  await expect(panel.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 15_000 })
  await panel.getByRole('button', { name: 'Seite in Notiz verlinken' }).click()
  await expect(editor.locator('a[href^="/api/files/Folien.pdf#page=1"]')).toHaveText('Folien.pdf, S. 1')
  await panel.getByRole('button', { name: 'PDF schließen' }).click()

  await expect(page.getByTestId('save-status')).toContainText('Gespeichert', { timeout: 10_000 })
  await shot(page, '40-rich-text')
  const saved = await savedContent(page, id)
  expect(saved.format).toBe('richtext')
  expect(saved.content).toContain('<strong>wichtig</strong>')

  // Nach dem Neuladen ist alles noch da – auch im Lesemodus
  await page.reload()
  await expect(page.getByTestId('rich-editor').locator('strong')).toHaveText('wichtig')
  await page.getByRole('radio', { name: 'Lesen' }).click()
  const view = page.getByTestId('rich-view')
  await expect(view.locator('h2')).toHaveText('Sitzung vom Montag')
  await expect(view.locator('span[style*="color"]')).toHaveText('rot')
  // Der Seitenlink öffnet das PDF im eingebauten Viewer
  await view.getByRole('link', { name: 'Folien.pdf, S. 1' }).click()
  await expect(page.getByTestId('pdf-panel')).toBeVisible()
  await page.getByTestId('pdf-panel').getByRole('button', { name: 'PDF schließen' }).click()

  // Suche findet den Text, nicht das HTML
  await page.goto('/?q=wichtig')
  await expect(page.getByRole('main').getByRole('link', { name: /Protokoll.*wichtig/ })).toBeVisible()

  // Umwandeln in Markdown: Formatierung, die Markdown nicht kennt, entfällt
  await page.goto(`/?n=${id}`)
  await page.getByRole('radio', { name: 'Bearbeiten' }).click()
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click()
  await page.getByRole('menuitem', { name: /Format/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('radio', { name: /^Markdown/ }).click()
  await expect(dialog.getByTestId('format-hint')).toContainText('Schriftfarben')
  await shot(page, '42-format-dialog')
  await dialog.getByRole('button', { name: 'Umwandeln' }).click()
  await expect(page.locator('.cm-content')).toContainText('## Sitzung vom Montag')
  await expect(page.locator('.cm-content')).toContainText('**wichtig**')
  await expect.poll(async () => (await savedContent(page, id)).format, { timeout: 10_000 }).toBe('markdown')
  expect((await savedContent(page, id)).content).toContain('[Folien.pdf, S. 1](/api/files/Folien.pdf#page=1)')
})

test('Einfacher Text: keine Formatierung, Format wird für die nächste Notiz gemerkt', async ({ page }) => {
  await login(page)
  await newNote(page, /Einfacher Text/, 'Einkaufsliste')
  // Kein Markdown-Werkzeug, keine Hervorhebung
  await expect(page.getByRole('toolbar', { name: 'Formatierung' })).toHaveCount(0)
  await page.locator('.cm-content').click()
  await page.keyboard.insertText('# keine Überschrift\n*Milch* und **Brot**')
  await expect(page.getByTestId('save-status')).toContainText('Gespeichert', { timeout: 10_000 })

  await page.getByRole('radio', { name: 'Lesen' }).click()
  const view = page.getByTestId('plain-view')
  await expect(view).toHaveText('# keine Überschrift\n*Milch* und **Brot**')
  await expect(view.locator('h1, em, strong')).toHaveCount(0)
  await shot(page, '41-plain-text')

  // Der Dialog schlägt beim nächsten Mal wieder „Einfacher Text“ vor
  await page.getByRole('button', { name: 'Neue Notiz' }).first().click()
  await expect(page.getByRole('dialog').getByRole('radio', { name: /Einfacher Text/ })).toHaveAttribute('aria-checked', 'true')
  await shot(page, '43-new-note-dialog')
  await page.getByRole('dialog').getByRole('button', { name: 'Abbrechen' }).click()
})
