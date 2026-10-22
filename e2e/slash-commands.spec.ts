import { expect, test, type Page } from '@playwright/test'
import { apiHeaders } from './helpers'

// Befehle mit „/“: im Markdown-Editor und im formatierten Text einfügen, Negativfälle, Handy und Einstellung.

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

let consoleErrors: string[] = []
// Alle Specs teilen sich das Admin-Konto: Was hier entsteht, wird wieder entfernt
const cleanup: string[] = []
test.beforeEach(({ page }) => {
  consoleErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/status of (401|403|404|409)/.test(msg.text())) consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(String(err)))
})
test.afterEach(async ({ page }) => {
  const headers = await apiHeaders(page)
  for (const url of cleanup.splice(0)) await page.request.delete(url, { headers })
  expect(consoleErrors, 'Fehler in der Browser-Konsole').toEqual([])
})

async function createNote(page: Page, title: string, content: string, format = 'markdown') {
  const headers = await apiHeaders(page)
  const res = await page.request.post('/api/notes', { headers, data: { title, content, format, folderId: null } })
  const note = (await res.json()).note as { id: string }
  cleanup.unshift(`/api/notes/${note.id}?permanent=1`)
  return note.id
}

/** CodeMirror zeigt Vorschläge erst nach kurzer Verzögerung und nimmt Enter erst danach an */
const settle = (page: Page) => page.waitForTimeout(300)

test('Markdown: Befehle mit „/“ einfügen, filtern und schließen', async ({ page }) => {
  await login(page)
  const id = await createNote(page, 'Slash Markdown', '```\nCODE\n```\n\n')
  await page.goto(`/?n=${id}`)
  const editor = page.locator('.cm-content')
  const menu = page.locator('.cm-tooltip-autocomplete')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+End')

  // Leerer Filter: alle 18 Befehle in fester Reihenfolge
  await page.keyboard.type('/')
  await expect(menu.getByRole('option')).toHaveCount(18)
  await expect(menu.getByRole('option').first()).toContainText('Überschrift 1')
  await shot(page, '97-slash-markdown')

  // Tabelle wie der Knopf – Cursor in der ersten Zelle, „/tab“ ist weg
  await page.keyboard.type('tab')
  await expect(menu.getByRole('option').first()).toContainText('Tabelle')
  await settle(page)
  await page.keyboard.press('Enter')
  await page.keyboard.type('A1')
  await expect(editor).toContainText('| Spalte 1 | Spalte 2 |')
  await expect(editor).toContainText('| A1 |  |')
  await expect(editor).not.toContainText('/tab')

  // Überschrift 2
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('/h2')
  await expect(menu.getByRole('option').first()).toContainText('Überschrift 2')
  await settle(page)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Kapitel')
  await expect(editor).toContainText('## Kapitel')

  // Callout: danach die vorhandene Auswahl der Typen
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/callout')
  await settle(page)
  await page.keyboard.press('Enter')
  await expect(menu).toContainText('warning')
  await page.keyboard.type('warn')
  await settle(page)
  await page.keyboard.press('Enter')
  await expect(editor).toContainText('> [!warning]')

  // Kein Menü bei Brüchen, Adressen und in Code
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('und/oder 1/2 http://example.org/a')
  await settle(page)
  await expect(menu).toHaveCount(0)
  await page.locator('.cm-line', { hasText: 'CODE' }).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' /ta')
  await settle(page)
  await expect(menu).toHaveCount(0)

  // Esc schließt – auch beim Weitertippen bleibt es für dieses „/“ zu, der Text bleibt
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(' /ta')
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await page.keyboard.type('b')
  await settle(page)
  await expect(menu).toHaveCount(0)
  await expect(editor).toContainText('/tab')

  // Backspace auf das „/“ und Leerzeichen schließen
  await page.keyboard.type(' /h')
  await expect(menu).toBeVisible()
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await expect(menu).toHaveCount(0)
  await page.keyboard.type('/h ')
  await settle(page)
  await expect(menu).toHaveCount(0)

  // Bild oder Datei: Dateidialog, danach steht die Einbettung, wo „/bild“ stand
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 40
    canvas.height = 30
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#1c7ed6'
    ctx.fillRect(0, 0, 40, 30)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await page.keyboard.press('Enter')
  await page.keyboard.type('/bild')
  await settle(page)
  const chooser = page.waitForEvent('filechooser')
  await page.keyboard.press('Enter')
  await (await chooser).setFiles({ name: 'Slashbild.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await expect(editor).toContainText(/!\[\[Slashbild.*\.png\]\]/)
  await expect(editor).not.toContainText('/bild')
  const list = (await (await page.request.get('/api/attachments')).json()).attachments as { id: string; filename: string }[]
  for (const att of list.filter((a) => a.filename.startsWith('Slashbild'))) cleanup.push(`/api/attachments/${att.id}`)

  // Datum von heute – Strg+Z nimmt die Einfügung zurück
  const today = await page.evaluate(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('/heute')
  await settle(page)
  await page.keyboard.press('Enter')
  await expect(editor).toContainText(today)
  await page.keyboard.press('ControlOrMeta+Z')
  await expect(editor).not.toContainText(today)
  await expect(page.getByTestId('save-status')).toContainText('Gespeichert', { timeout: 10_000 })
  const saved = (await (await page.request.get(`/api/notes/${id}`)).json()).note.content as string
  expect(saved).toContain('## Kapitel')
})

test('Formatierter Text: Befehle mit „/“, nicht in Code', async ({ page }) => {
  await login(page)
  const id = await createNote(page, 'Slash formatiert', '<p></p>', 'richtext')
  await page.goto(`/?n=${id}`)
  const editor = page.getByTestId('rich-editor')
  const menu = page.getByRole('listbox', { name: 'Befehle' })
  await editor.click()

  await page.keyboard.type('/')
  await expect(menu.getByRole('option')).toHaveCount(13)
  await shot(page, '98-slash-richtext')
  await page.keyboard.type('h2')
  await expect(menu.getByRole('option').first()).toHaveText('Überschrift 2')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Kapitel')
  await expect(editor.locator('h2')).toHaveText('Kapitel')
  await expect(menu).toHaveCount(0)

  await page.keyboard.press('Enter')
  await page.keyboard.type('/tab')
  await expect(menu.getByRole('option', { name: 'Tabelle' })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
  await expect(editor.locator('table')).toBeVisible()
  await expect(editor).not.toContainText('/tab')
  // In einer Tabelle gibt es keine weitere Tabelle; Esc schließt und bleibt zu
  await page.keyboard.type('/ta')
  await expect(menu).toBeVisible()
  await expect(menu).not.toContainText('Tabelle')
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await page.keyboard.type('s')
  await expect(menu).toHaveCount(0)

  // Strg+Z nimmt die Einfügung zurück; im Code-Block gibt es kein Menü. Die Pausen trennen die Schritte im Verlauf –
  // schneller als 500 ms Getipptes fasst der Editor zu einem Schritt zusammen
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(600)
  await page.keyboard.type('/code')
  await page.waitForTimeout(600)
  await page.keyboard.press('Enter')
  await expect(editor.locator('pre')).toBeVisible()
  await page.keyboard.press('ControlOrMeta+Z')
  await expect(editor.locator('pre')).toHaveCount(0)
  await expect(editor).toContainText('/code')
  await page.keyboard.press('Escape')
  await page.keyboard.press('ControlOrMeta+Shift+Z')
  await expect(editor.locator('pre')).toBeVisible()
  await page.keyboard.type('a /ta')
  await page.waitForTimeout(300)
  await expect(menu).toHaveCount(0)
})

test('Handy: Menü im sichtbaren Bereich, Antippen fügt ein; abschaltbar', async ({ page, browser }) => {
  await login(page)
  const id = await createNote(page, 'Slash Handy', '')
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: 'de-DE',
    storageState: await page.context().storageState(),
  })
  const mobile = await context.newPage()
  await mobile.goto(`/?n=${id}`)
  const editor = mobile.locator('.cm-content')
  await editor.tap()
  await mobile.keyboard.type('/tab')
  const option = mobile.locator('.cm-tooltip-autocomplete').getByRole('option', { name: /Tabelle/ })
  await expect(option).toBeInViewport()
  await shot(mobile, '99-slash-mobile')
  await settle(mobile)
  await option.tap()
  await expect(editor).toContainText('| Spalte 1 | Spalte 2 |')
  await expect(editor).toBeFocused()

  // Abgeschaltet: kein Menü mehr
  await mobile.evaluate(() => localStorage.setItem('noted:slashCommands', '0'))
  await mobile.reload()
  await editor.tap()
  await mobile.keyboard.press('ControlOrMeta+End')
  await mobile.keyboard.type('/tab')
  await settle(mobile)
  await expect(mobile.locator('.cm-tooltip-autocomplete')).toHaveCount(0)
  await context.close()
})
