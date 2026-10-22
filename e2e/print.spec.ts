import { expect, test, type Page } from '@playwright/test'
import { apiHeaders, pdfPages } from './helpers'

// Drucken: Druckansicht für Notizen, Glossar und Stapel – im Druck nur das helle Blatt, auch offline.

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
test.beforeEach(async ({ page }) => {
  consoleErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/status of (401|403|404|409)/.test(msg.text())) consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(String(err)))
  // Der Druckdialog lässt sich nicht bedienen – stattdessen zählen, wie oft er aufgerufen wird
  await page.addInitScript(() => {
    const w = window as unknown as { printCalls: number }
    w.printCalls = 0
    window.print = () => {
      w.printCalls++
    }
  })
})
test.afterEach(async ({ page }) => {
  await page.context().setOffline(false)
  const headers = await apiHeaders(page)
  for (const url of cleanup.splice(0)) await page.request.delete(url, { headers })
  expect(consoleErrors, 'Fehler in der Browser-Konsole').toEqual([])
})

const printCalls = (page: Page) => page.evaluate(() => (window as unknown as { printCalls: number }).printCalls)

async function post<T = { id: string }>(page: Page, url: string, data: object, key: string): Promise<T> {
  const res = await page.request.post(url, { headers: await apiHeaders(page), data })
  expect(res.ok()).toBe(true)
  return (await res.json())[key] as T
}

async function createNote(page: Page, title: string, content: string, format = 'markdown', folderId: string | null = null) {
  const note = await post(page, '/api/notes', { title, content, format, folderId }, 'note')
  cleanup.unshift(`/api/notes/${note.id}?permanent=1`)
  return note.id
}

async function openNotePrint(page: Page) {
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click()
  await page.getByRole('menuitem', { name: 'Drucken …' }).click()
  await expect(page.getByTestId('print-view')).toBeVisible()
}

const filler = Array.from({ length: 60 }, (_, i) => `Absatz ${i + 1}: Die innere Energie eines abgeschlossenen Systems bleibt erhalten.`).join('\n\n')

test('Notiz im dunklen Design drucken: nur das helle Blatt, über mehrere Seiten', async ({ page }) => {
  await login(page)
  const content = [
    '---',
    'quelle: Skript Kapitel 3',
    '---',
    '# Hauptsätze',
    '',
    '> [!faq]- Was ist Entropie?',
    '> Ein Maß für die Zahl der Mikrozustände.',
    '',
    'Nur für mich: %%geheim%%',
    '',
    '$$',
    '\\Delta S = \\frac{Q}{T}',
    '$$',
    '',
    '```mermaid',
    'flowchart TD',
    '    A --> B',
    '```',
    '',
    'Mehr in der [Quelle](https://example.org/quelle).',
    '',
    filler,
  ].join('\n')
  const id = await createNote(page, 'Druck Thermodynamik', content)
  await page.evaluate(() => {
    localStorage.setItem('noted:theme', 'dark')
    localStorage.setItem('noted:mode', 'read')
  })
  await page.goto(`/?n=${id}`)
  await openNotePrint(page)
  const view = page.getByTestId('print-view')
  const sheet = page.getByTestId('print-sheet')
  const print = view.getByRole('button', { name: 'Drucken', exact: true })
  await expect(print).toBeEnabled({ timeout: 15_000 })
  await expect(page).toHaveTitle('Druck Thermodynamik')
  await shot(page, '100-print-preview')
  await print.click()
  await expect.poll(() => printCalls(page)).toBe(1)

  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('aside').first()).toBeHidden()
  await expect(page.getByTestId('global-toolbar')).toBeHidden()
  await expect(print).toBeHidden()
  await expect(sheet).toBeVisible()
  const style = await sheet.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }))
  expect(style).toEqual({ bg: 'rgb(255, 255, 255)', color: 'rgb(26, 32, 48)' })
  await expect(sheet.locator('.callout-content')).toBeVisible()
  await expect(sheet).not.toContainText('geheim')
  await expect(sheet.locator('.mermaid-block svg')).toBeVisible()
  await expect(sheet.locator('.katex-display')).toBeVisible()
  const after = await sheet.locator('a[href="https://example.org/quelle"]').evaluate((el) => getComputedStyle(el, '::after').content)
  expect(after).toContain('https://example.org/quelle')
  // Properties erst mit der Option – die Leiste gibt es nur auf dem Bildschirm
  await expect(sheet).not.toContainText('Skript Kapitel 3')
  await page.emulateMedia({ media: 'screen' })
  await view.getByLabel('Properties').check()
  await expect(sheet).toContainText('Skript Kapitel 3')

  // page.pdf() nimmt die eingestellten Medien – also wieder „print“
  await page.emulateMedia({ media: 'print' })
  const pages = await pdfPages(await page.pdf({ format: 'A4' }))
  expect(pages.length).toBeGreaterThanOrEqual(2)
  expect(pages[0]).toContain('Druck Thermodynamik')
  expect(pages[0]).not.toContain('Papierkorb')

  await page.emulateMedia({ media: 'screen' })
  await page.keyboard.press('Escape')
  await expect(view).toHaveCount(0)
  await expect(page.locator('html')).not.toHaveClass(/print-open/)
  await expect(page).not.toHaveTitle('Druck Thermodynamik')
  await page.evaluate(() => localStorage.setItem('noted:theme', 'light'))
})

test('Strg/⌘+P: in der Notiz die Druckansicht, sonst der Schnellwechsler', async ({ page }) => {
  await login(page)
  const id = await createNote(page, 'Druck Kürzel', 'Kurzer Text.')
  await page.evaluate(() => localStorage.setItem('noted:mode', 'read'))
  await page.goto(`/?n=${id}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Druck Kürzel' })).toBeVisible()
  await page.keyboard.press('ControlOrMeta+p')
  const view = page.getByTestId('print-view')
  await expect(view).toBeVisible()
  // In der Druckansicht druckt das Kürzel – sobald alles bereit ist
  await page.keyboard.press('ControlOrMeta+p')
  await expect.poll(() => printCalls(page)).toBe(1)
  await page.keyboard.press('Escape')
  await expect(view).toHaveCount(0)

  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Administrator')
  await page.keyboard.press('ControlOrMeta+p')
  await expect(page.getByRole('dialog', { name: 'Schnellwechsler' })).toBeVisible()
  await expect(view).toHaveCount(0)
})

test('Formatierten Text und Mindmap drucken', async ({ page }) => {
  await login(page)
  const rich = await createNote(page, 'Druck formatiert', '<h2>Formatiert</h2><p>Text mit <strong>fett</strong>.</p>', 'richtext')
  const mindmap = await createNote(
    page,
    'Druck Mindmap',
    '---\nmindmap-plugin: basic\n---\n\n# Zelle\n\n## Zellkern\n\n## Mitochondrien\n',
    'mindmap',
  )
  await page.evaluate(() => localStorage.setItem('noted:mode', 'read'))
  await page.goto(`/?n=${rich}`)
  await openNotePrint(page)
  const sheet = page.getByTestId('print-sheet')
  await expect(sheet.locator('h2', { hasText: 'Formatiert' })).toBeVisible()
  await expect(sheet.locator('strong')).toHaveText('fett')
  await page.keyboard.press('Escape')

  await page.goto(`/?n=${mindmap}`)
  await openNotePrint(page)
  await expect(page.getByTestId('print-view')).toContainText('Die Mindmap wird als Gliederung gedruckt.')
  await expect(sheet).not.toContainText('mindmap-plugin')
  await expect(sheet.locator('h1', { hasText: 'Zelle' })).toBeVisible()
  await expect(sheet.locator('h2', { hasText: 'Zellkern' })).toBeVisible()
  // Kein zweiter Titel über der Wurzel
  await expect(page.getByTestId('print-view').getByLabel('Titel')).toHaveCount(0)
  await expect(sheet.locator('.print-title')).toHaveCount(0)
})

test('Glossar drucken: Begriffe und Formeln, Formeln abwählbar', async ({ page }) => {
  await login(page)
  const folder = await post(page, '/api/folders', { name: 'Druck-Glossar', parentId: null }, 'folder')
  await createNote(
    page,
    'Druck Analysis',
    '# Folgen\n> [!info] Grenzwert\n> Zahl, der sich die Folge nähert\n\n## Reihen\n$$\n\\sum_{k=1}^\\infty a_k\n$$\n',
    'markdown',
    folder.id,
  )
  cleanup.push(`/api/folders/${folder.id}`)
  await page.goto(`/?v=glossary&in=${folder.id}`)
  await expect(page.getByTestId('glossary-terms')).toContainText('Grenzwert')
  await page.getByRole('button', { name: 'Glossar-Aktionen' }).click()
  await page.getByRole('menuitem', { name: 'Drucken …' }).click()
  const view = page.getByTestId('print-view')
  const sheet = page.getByTestId('print-sheet')
  await expect(sheet.locator('.print-title')).toHaveText('Glossar – Druck-Glossar')
  await expect(sheet).toContainText('Grenzwert')
  await expect(sheet).toContainText('Druck Analysis › Folgen')
  await expect(sheet.locator('.katex-display')).toHaveCount(1)
  await view.getByLabel('Formeln').uncheck()
  await expect(sheet.locator('.katex-display')).toHaveCount(0)
  await expect(sheet).toContainText('Grenzwert')
  await view.getByLabel('Fundstellen').uncheck()
  await expect(sheet).not.toContainText('Druck Analysis › Folgen')
  await view.getByLabel('Formeln').check()
  await view.getByLabel('Fundstellen').check()
  await page.keyboard.press('Escape')
})

test('Stapel drucken – auch als Fragebogen ohne Antworten', async ({ page }) => {
  await login(page)
  const deck = await post(page, '/api/decks', { name: 'Druck-Stapel', description: 'Für die Klausur' }, 'deck')
  cleanup.push(`/api/decks/${deck.id}`)
  const res = await page.request.post(`/api/decks/${deck.id}/cards`, {
    headers: await apiHeaders(page),
    data: {
      cards: [
        { type: 'basic', front: 'Was ist ein Grenzwert?', back: 'Die Zahl, der sich die Folge nähert' },
        { type: 'cloze', front: 'Die Ableitung von ==sin== ist ==cos==.' },
      ],
    },
  })
  expect(res.ok()).toBe(true)
  await page.goto(`/?d=${deck.id}`)
  await page.getByRole('button', { name: 'Stapel-Aktionen' }).click()
  await page.getByRole('menuitem', { name: 'Drucken …' }).click()
  const view = page.getByTestId('print-view')
  const sheet = page.getByTestId('print-sheet')
  await expect(sheet.locator('.print-title')).toHaveText('Druck-Stapel')
  await expect(sheet).toContainText('Für die Klausur · 2 Karten')
  await expect(sheet).toContainText('Die Zahl, der sich die Folge nähert')
  await expect(sheet.locator('mark')).toHaveCount(2)
  await shot(page, '101-print-deck')
  await view.getByLabel('Antworten').uncheck()
  await expect(sheet).not.toContainText('Die Zahl, der sich die Folge nähert')
  await expect(sheet.locator('.cloze-gap')).toHaveCount(2)
  await expect(sheet.locator('.cloze-gap').first()).toHaveText('[…]')
  await view.getByLabel('Antworten').check()
  await page.keyboard.press('Escape')
})

test('Offline drucken', async ({ page, context }) => {
  await login(page)
  const id = await createNote(page, 'Druck offline', 'Auch ohne Netz.')
  await page.evaluate(() => localStorage.setItem('noted:mode', 'read'))
  await page.goto(`/?n=${id}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Druck offline' })).toBeVisible()
  await context.setOffline(true)
  await openNotePrint(page)
  const print = page.getByTestId('print-view').getByRole('button', { name: 'Drucken', exact: true })
  await expect(print).toBeEnabled({ timeout: 15_000 })
  await print.click()
  await expect.poll(() => printCalls(page)).toBe(1)
  await page.keyboard.press('Escape')
  await context.setOffline(false)
})
