import { expect, test, type Page } from '@playwright/test'
import { apiHeaders } from './helpers'

// Graph mit der Tastatur: Pfeiltasten wählen eine Notiz, Enter öffnet sie – in der Gesamtansicht und im lokalen Graphen.

const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'E2E-Admin-Passwort-1'

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

test('Graph: Notizen mit den Pfeiltasten wählen und mit Enter öffnen', async ({ page }) => {
  await login(page)
  const headers = await apiHeaders(page)
  const create = async (title: string, content: string) => {
    const data = { title, content, folderId: null }
    const note = (await (await page.request.post('/api/notes', { headers, data })).json()).note as { id: string }
    cleanup.unshift(`/api/notes/${note.id}?permanent=1`)
    return note
  }
  const anfang = await create('Pfeiltaste Anfang', 'Weiter zu [[Pfeiltaste Ziel]]')
  const ziel = await create('Pfeiltaste Ziel', 'Zurück zu [[Pfeiltaste Anfang]]')
  await page.reload()

  await page.getByRole('navigation').getByRole('link', { name: 'Graph' }).click()
  await expect(page).toHaveURL(/v=graph/)
  const graph = page.getByRole('application', { name: /^Graph der Notizen/ })
  const status = graph.getByTestId('graph-status')
  await expect(graph.getByTestId(`rf__node-${ziel.id}`)).toBeVisible()

  // Während einer Suche wechseln die Pfeiltasten nur zwischen den Treffern – hier genau einer. Tab führt vom Suchfeld
  // auf die Fläche, die erste Pfeiltaste wählt den Treffer nahe der Mitte
  await page.getByLabel('Notiz im Graphen hervorheben').fill('pfeiltaste ziel')
  await page.keyboard.press('Tab')
  await expect(graph).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(status).toHaveText('Pfeiltaste Ziel, 2 Verbindungen')

  // Umschalt+F10 öffnet das Menü der gewählten Notiz; Escape schließt es, der Fokus kommt zurück
  const menu = page.getByRole('menu', { name: 'Kontextmenü' })
  await page.keyboard.press('Shift+F10')
  await expect(menu.getByRole('menuitem', { name: 'Notiz öffnen' })).toBeFocused()
  await expect(menu.getByRole('menuitem', { name: 'Als [[Wikilink]] kopieren' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(graph).toBeFocused()

  // Escape hebt die Auswahl auf, die nächste Pfeiltaste beginnt neu; Enter öffnet wie ein Klick
  await page.keyboard.press('Escape')
  await expect(status).toHaveText('Auswahl aufgehoben.')
  await page.keyboard.press('ArrowLeft')
  await expect(status).toHaveText('Pfeiltaste Ziel, 2 Verbindungen')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('note-title')).toHaveValue('Pfeiltaste Ziel')

  // Lokaler Graph im Lesemodus: Die erste Pfeiltaste wählt die Notiz in der Mitte, Enter öffnet die verlinkte
  await page.getByRole('radio', { name: 'Lesen' }).click()
  await page.getByRole('button', { name: 'Lokaler Graph' }).click()
  const local = page.getByRole('application', { name: /^Lokaler Graph/ })
  const localStatus = local.getByTestId('graph-status')
  await expect(local.getByTestId(`rf__node-${anfang.id}`)).toBeVisible()
  await local.focus()
  await page.keyboard.press('ArrowDown')
  await expect(localStatus).toHaveText('Pfeiltaste Ziel (diese Notiz), 2 Verbindungen')
  // Wo die verlinkte Notiz liegt, entscheidet die Anordnung – in einer der vier Richtungen liegt sie
  for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp']) {
    await page.keyboard.press(key)
    if ((await localStatus.textContent())?.startsWith('Pfeiltaste Anfang')) break
  }
  await expect(localStatus).toHaveText('Pfeiltaste Anfang, 2 Verbindungen')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('note-title')).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 1, name: 'Pfeiltaste Anfang' })).toBeVisible()
})
