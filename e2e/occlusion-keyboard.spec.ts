import { expect, test, type Page } from '@playwright/test'
import { apiHeaders } from './helpers'

// Bildverdeckung mit der Tastatur: Flächen per Knopf anlegen, mit den Pfeiltasten verschieben und in der Größe ändern.

const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'E2E-Admin-Passwort-1'

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Benutzername').fill('admin')
  await page.getByLabel('Passwort', { exact: true }).fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Administrator')
}

async function post<T = { id: string }>(page: Page, url: string, data: object, key: string): Promise<T> {
  const res = await page.request.post(url, { headers: await apiHeaders(page), data })
  expect(res.ok()).toBe(true)
  return (await res.json())[key] as T
}

const flashcards = (page: Page) => page.evaluate(() => fetch('/api/flashcards').then((r) => r.json()))

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

test('Bildverdeckung: Fläche hinzufügen, mit der Tastatur verschieben, in der Größe ändern und speichern', async ({ page }) => {
  await login(page)
  const deck = await post(page, '/api/decks', { name: 'Tastatur-Anatomie' }, 'deck')
  cleanup.push(`/api/decks/${deck.id}`)
  // Ein schlichtes Bild, im Browser gezeichnet
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 400
    canvas.height = 240
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, 400, 240)
    ctx.fillStyle = '#c00'
    ctx.beginPath()
    ctx.arc(200, 130, 70, 0, Math.PI * 2)
    ctx.fill()
    return canvas.toDataURL('image/png').split(',')[1]
  })

  await page.goto(`/?d=${deck.id}`)
  await page.getByTestId('add-card').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('radio', { name: 'Bildverdeckung' }).click()
  await dialog
    .getByTestId('occlusion-upload')
    .setInputFiles({ name: 'Tastaturbild.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  const editor = dialog.getByRole('application', { name: /Flächen zum Verdecken/ })
  const status = dialog.getByTestId('occlusion-status')
  await expect(editor.locator('img')).toBeVisible()
  await expect(dialog.getByText('Tastatur im Bild:')).toBeVisible()

  // Der Knopf legt eine Fläche in der Mitte an (20 % × 12 %) und wählt sie – die Tastatur macht im Bild gleich weiter
  await dialog.getByRole('button', { name: 'Fläche hinzufügen' }).click()
  await expect(editor.locator('[data-mask]')).toHaveCount(1)
  await expect(editor).toBeFocused()
  await expect(status).toHaveText('Fläche 1 hinzugefügt und ausgewählt.')

  // Pfeiltasten verschieben um 1 % des Bilds, mit Umschalt um 5 %; mit Alt ändern sie die Größe
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(status).toHaveText('Fläche 1 verschoben: 42 % von links, 44 % von oben.')
  await page.keyboard.press('Shift+ArrowDown')
  await expect(status).toHaveText('Fläche 1 verschoben: 42 % von links, 49 % von oben.')
  await page.keyboard.press('Alt+Shift+ArrowRight')
  await expect(status).toHaveText('Fläche 1: 25 % breit, 12 % hoch.')
  await page.keyboard.press('Alt+ArrowUp')
  await expect(status).toHaveText('Fläche 1: 25 % breit, 11 % hoch.')

  // Eine zweite Fläche: Komma und Punkt wechseln zwischen den Flächen, Entf löscht die gewählte
  await dialog.getByRole('button', { name: 'Fläche hinzufügen' }).click()
  await expect(editor.locator('[data-mask]')).toHaveCount(2)
  await expect(status).toHaveText('Fläche 2 hinzugefügt und ausgewählt.')
  await page.keyboard.press(',')
  await expect(status).toHaveText('Fläche 1 von 2 ausgewählt.')
  await page.keyboard.press('.')
  await expect(status).toHaveText('Fläche 2 von 2 ausgewählt.')
  await page.keyboard.press('Delete')
  await expect(editor.locator('[data-mask]')).toHaveCount(1)
  await expect(status).toHaveText('Fläche 2 gelöscht.')

  // Escape hebt die Auswahl auf – der Dialog bleibt offen; ohne Auswahl bewegen die Pfeiltasten nichts
  await page.keyboard.press('.')
  await expect(status).toHaveText('Fläche 1 von 1 ausgewählt.')
  await page.keyboard.press('Escape')
  await expect(status).toHaveText('Auswahl aufgehoben.')
  await expect(dialog).toBeVisible()
  await page.keyboard.press('ArrowLeft')
  await expect(status).toHaveText('Keine Fläche ausgewählt – Punkt wählt die nächste.')

  await dialog.getByLabel('Beschriftung von Fläche 1').fill('Herz')
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click()
  await expect(dialog).toBeHidden()
  const saved = (await flashcards(page)).cards.find((c: { deckId: string }) => c.deckId === deck.id)
  const near = (n: number) => expect.closeTo(n, 4)
  expect(saved.occlusion.masks).toEqual([{ x: near(0.42), y: near(0.49), w: near(0.25), h: near(0.11), label: 'Herz' }])

  const { attachments } = await (await page.request.get('/api/attachments')).json()
  for (const a of attachments as { id: string; filename: string }[]) {
    if (a.filename.startsWith('Tastaturbild')) cleanup.push(`/api/attachments/${a.id}`)
  }
})
