import { expect, test, type Page } from '@playwright/test'
import { apiHeaders } from './helpers'

// Canvas nur mit der Tastatur: Karten wählen, verschieben, in der Größe ändern, verbinden – und die Fläche verlassen.

const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'E2E-Admin-Passwort-1'

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Benutzername').fill('admin')
  await page.getByLabel('Passwort', { exact: true }).fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Administrator')
}

type SavedCanvas = {
  nodes: { id: string; x: number; y: number; width: number; height: number }[]
  edges: { fromNode: string; toNode: string; label?: string }[]
}

const savedCanvas = (page: Page, id: string) =>
  page
    .evaluate((noteId) => fetch(`/api/notes/${noteId}`).then((r) => r.json()), id)
    .then((r) => JSON.parse(r.note.content) as SavedCanvas)

async function waitSaved(page: Page) {
  await expect(page.getByTestId('save-status')).toContainText('Gespeichert', { timeout: 10_000 })
}

const textCard = (id: string, text: string, x: number, y: number) => ({ id, type: 'text', text, x, y, width: 260, height: 120 })

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

test('Canvas mit der Tastatur: wählen, verschieben, verbinden und die Fläche verlassen', async ({ page }) => {
  await login(page)
  // Alpha  Beta
  // Gamma
  const created = await page.request.post('/api/notes', {
    headers: await apiHeaders(page),
    data: {
      title: 'Tastatur-Canvas',
      format: 'canvas',
      content: JSON.stringify({
        nodes: [textCard('alpha', 'Alpha', 0, 0), textCard('beta', 'Beta', 500, 0), textCard('gamma', 'Gamma', 0, 300)],
        edges: [],
      }),
    },
  })
  expect(created.status()).toBe(201)
  const id = (await created.json()).note.id as string
  await page.goto(`/?n=${id}`)
  await page.getByRole('radio', { name: 'Bearbeiten' }).click()

  const canvas = page.getByTestId('canvas')
  const status = canvas.getByRole('status')
  const cards = canvas.getByTestId('canvas-text')
  const card = (text: string) => cards.filter({ hasText: text })
  const selected = canvas.locator('.canvas-card.is-selected')
  const gamma = canvas.locator('.react-flow__node').filter({ hasText: 'Gamma' })
  await expect(cards).toHaveCount(3)

  // Wählen: Ohne Auswahl nimmt die erste Pfeiltaste die Karte nahe der Bildmitte – nach oben und links ist es Alpha
  const selectAlpha = async () => {
    await canvas.focus()
    await page.keyboard.press('Escape')
    await page.keyboard.press('ArrowRight')
    await expect(selected).toHaveCount(1)
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowLeft')
    await expect(card('Alpha')).toHaveClass(/is-selected/)
  }
  await selectAlpha()
  await page.keyboard.press('ArrowRight')
  await expect(card('Beta')).toHaveClass(/is-selected/)
  await expect(status).toContainText('Textkarte „Beta“, 2 von 3')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowDown')
  await expect(card('Gamma')).toHaveClass(/is-selected/)
  await expect(selected).toHaveCount(1)
  await expect(status).toContainText('Textkarte „Gamma“, 3 von 3')

  // Verschieben: Alt+Pfeil um 20 px, mit Umschalt um 100 px; Strg+Z nimmt einen Schritt zurück
  await expect(gamma).toHaveAttribute('style', /translate\(0px, ?300px\)/)
  await page.keyboard.press('Alt+ArrowRight')
  await page.keyboard.press('Alt+ArrowRight')
  await page.keyboard.press('Alt+Shift+ArrowDown')
  await expect(gamma).toHaveAttribute('style', /translate\(40px, ?400px\)/)
  await expect(status).toContainText('nach unten verschoben (x 40, y 400)')
  await page.keyboard.press('Alt+ArrowLeft')
  await expect(gamma).toHaveAttribute('style', /translate\(20px, ?400px\)/)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(gamma).toHaveAttribute('style', /translate\(40px, ?400px\)/)

  // Größe: Strg+Pfeil nach rechts macht die Karte breiter
  await page.keyboard.press('ControlOrMeta+ArrowRight')
  await expect(gamma).toHaveAttribute('style', /width: 280px/)
  await expect(status).toContainText('Breite 280, Höhe 120')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(gamma).toHaveAttribute('style', /width: 260px/)

  // Die neue Lage ist gespeichert und bleibt nach dem Neuladen
  await expect
    .poll(async () => (await savedCanvas(page, id)).nodes.find((n) => n.id === 'gamma'), { timeout: 10_000 })
    .toMatchObject({ x: 40, y: 400, width: 260 })
  await waitSaved(page)
  await page.reload()
  await page.getByRole('radio', { name: 'Bearbeiten' }).click()
  await expect(gamma).toHaveAttribute('style', /translate\(40px, ?400px\)/)

  // Verbinden: V, Ziel mit den Pfeiltasten, Enter – Enter beschriftet danach den neuen Pfeil
  await selectAlpha()
  await page.keyboard.press('v')
  const hint = canvas.getByText('Verbinden: Ziel mit den Pfeiltasten wählen')
  await expect(hint).toBeVisible()
  await expect(status).toContainText('Verbinden von Textkarte „Alpha“')
  await page.keyboard.press('ArrowRight')
  await expect(card('Beta')).toHaveClass(/is-connect-target/)
  await expect(status).toContainText('Ziel: Textkarte „Beta“')
  await page.keyboard.press('Enter')
  await expect(canvas.locator('.react-flow__edge')).toHaveCount(1)
  await expect(hint).toHaveCount(0)
  await expect(card('Beta')).not.toHaveClass(/is-connect-target/)
  await page.keyboard.press('Enter')
  await page.keyboard.type('führt zu')
  await page.keyboard.press('Enter')
  await expect(canvas.locator('.canvas-edge-label')).toHaveText('führt zu')
  await expect
    .poll(async () => (await savedCanvas(page, id)).edges, { timeout: 10_000 })
    .toEqual([expect.objectContaining({ fromNode: 'alpha', toNode: 'beta', label: 'führt zu' })])

  // Escape bricht das Verbinden ab, ohne einen Pfeil anzulegen
  await selectAlpha()
  await page.keyboard.press('v')
  await expect(hint).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  await expect(hint).toHaveCount(0)
  await expect(status).toContainText('Verbinden abgebrochen')
  await expect(card('Alpha')).toHaveClass(/is-selected/)
  await expect(canvas.locator('.react-flow__edge')).toHaveCount(1)

  // Keine Tastaturfalle: Tab und Umschalt+Tab verlassen die Fläche
  await canvas.focus()
  await page.keyboard.press('Tab')
  await expect(canvas).not.toBeFocused()
  await canvas.focus()
  await page.keyboard.press('Shift+Tab')
  await expect.poll(() => canvas.evaluate((el) => el.contains(document.activeElement))).toBe(false)

  // Zum Lesen: Pfeiltasten wählen weiter, verschieben lässt sich nichts
  await waitSaved(page)
  await page.getByRole('radio', { name: 'Lesen' }).click()
  await expect(page.getByRole('toolbar', { name: 'Canvas' })).toHaveCount(0)
  await canvas.focus()
  await page.keyboard.press('ArrowRight')
  await expect(selected).toHaveCount(1)
  await page.keyboard.press('Alt+ArrowDown')
  await expect(status).not.toContainText('verschoben')
  await expect(gamma).toHaveAttribute('style', /translate\(40px, ?400px\)/)
})
