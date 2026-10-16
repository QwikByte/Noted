import { expect, test, type Page } from '@playwright/test'
import { apiHeaders } from './helpers'

// Mindmap (Markdown-Gliederung) und Canvas (JSON Canvas): bearbeiten, speichern, lesen und umwandeln.

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
  return new URL(page.url()).searchParams.get('n')!
}

const savedNote = (page: Page, id: string) =>
  page
    .evaluate((noteId) => fetch(`/api/notes/${noteId}`).then((r) => r.json()), id)
    .then((r) => r.note as { content: string; format: string; tags: string[] })

async function waitSaved(page: Page) {
  await expect(page.getByTestId('save-status')).toContainText('Gespeichert', { timeout: 10_000 })
}

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

test('Mindmap: mit der Tastatur aufbauen, als Markdown-Gliederung speichern, lesen und umwandeln', async ({ page }) => {
  await login(page)
  const id = await newNote(page, /Mindmap/, 'Thermodynamik')
  const map = page.getByTestId('mindmap')
  const nodes = map.getByTestId('mind-node')
  // Neue Mindmap: Wurzel heißt wie die Notiz und ist ausgewählt – Tab legt sofort den ersten Ast an
  await expect(nodes).toHaveCount(1)
  await expect(nodes.first()).toHaveText('Thermodynamik')
  await expect(nodes.first()).toHaveAttribute('aria-selected', 'true')
  await expect(map).toBeFocused()

  await page.keyboard.press('Tab')
  await page.keyboard.type('Hauptsätze')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Erster Hauptsatz')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Zweiter Hauptsatz #physik')
  await page.keyboard.press('Enter')
  // Zur Wurzel und zwei weitere Äste
  await map.locator('[data-depth="0"]').click()
  await page.keyboard.press('Tab')
  await page.keyboard.type('Begriffe')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('[[Entropie]]')
  await page.keyboard.press('Enter')
  await expect(nodes).toHaveCount(6)
  await waitSaved(page)
  await shot(page, '50-mindmap')
  let saved = await savedNote(page, id)
  expect(saved.format).toBe('mindmap')
  expect(saved.content).toBe(
    '---\nmindmap-plugin: basic\n---\n\n# Thermodynamik\n\n## Hauptsätze\n- Erster Hauptsatz\n- Zweiter Hauptsatz #physik\n\n## Begriffe\n\n## [[Entropie]]\n',
  )
  expect(saved.tags).toEqual(['physik'])

  // Doppelklick bearbeitet, Entf löscht, Strg+Z holt zurück
  await nodes.filter({ hasText: 'Begriffe' }).dblclick()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('Grundbegriffe')
  await page.keyboard.press('Enter')
  await expect(nodes.filter({ hasText: 'Grundbegriffe' })).toHaveCount(1)
  await page.keyboard.press('Delete')
  await expect(nodes.filter({ hasText: 'Grundbegriffe' })).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(nodes.filter({ hasText: 'Grundbegriffe' })).toHaveCount(1)

  // Ast einklappen zeigt die Zahl der versteckten Punkte
  await nodes.filter({ hasText: 'Hauptsätze' }).getByRole('button', { name: 'Ast einklappen' }).click()
  await expect(nodes).toHaveCount(4)
  await nodes.filter({ hasText: 'Hauptsätze' }).getByRole('button', { name: 'Ast aufklappen (2)' }).click()
  await expect(nodes).toHaveCount(6)

  // Lesemodus: keine Werkzeugleiste, Wikilinks führen zur Notiz (bzw. legen sie an)
  await waitSaved(page)
  await page.getByRole('radio', { name: 'Lesen' }).click()
  await expect(page.getByRole('toolbar', { name: 'Mindmap' })).toHaveCount(0)
  await expect(nodes).toHaveCount(6)
  await shot(page, '51-mindmap-read')

  // Geteilte Ansicht: Gliederung als Text bearbeiten, die Mindmap folgt
  await page.getByRole('radio', { name: 'Geteilt' }).click()
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.insertText('- Wärme\n')
  await expect(nodes.filter({ hasText: 'Wärme' })).toHaveCount(1)
  await shot(page, '52-mindmap-split')
  await waitSaved(page)

  // Nach dem Neuladen ist alles da; Umwandeln in Markdown behält die Gliederung
  await page.reload()
  await page.getByRole('radio', { name: 'Bearbeiten' }).click()
  await expect(nodes).toHaveCount(7)
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click()
  await page.getByRole('menuitem', { name: /Format/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('radio', { name: /^Markdown/ }).click()
  await expect(dialog.getByTestId('format-hint')).toContainText('Gliederung bleibt')
  await dialog.getByRole('button', { name: 'Umwandeln' }).click()
  await expect(page.locator('.cm-content')).toContainText('## Hauptsätze')
  await expect.poll(async () => (await savedNote(page, id)).format, { timeout: 10_000 }).toBe('markdown')
  saved = await savedNote(page, id)
  expect(saved.content.startsWith('# Thermodynamik\n')).toBe(true)
})

test('Canvas: Karten anlegen, verbinden, färben, gruppieren und Notizen einbetten', async ({ page }) => {
  await login(page)
  const id = await newNote(page, /Canvas/, 'Lernübersicht')
  const canvas = page.getByTestId('canvas')
  await expect(canvas.getByText('Doppelklick auf die Fläche')).toBeVisible()

  // Textkarte über die Werkzeugleiste – Escape speichert
  await page.getByRole('button', { name: 'Textkarte' }).click()
  await page.keyboard.type('## Wärme\nEnergie, die übertragen wird #physik')
  await page.keyboard.press('Escape')
  const cards = canvas.getByTestId('canvas-text')
  await expect(cards.first().locator('h2')).toHaveText('Wärme')

  // Zweite Karte per Doppelklick auf die Fläche
  const box = (await canvas.boundingBox())!
  await page.mouse.dblclick(box.x + box.width * 0.8, box.y + box.height * 0.25)
  await page.keyboard.type('Temperatur')
  await page.keyboard.press('Escape')
  await expect(cards).toHaveCount(2)

  // Verbinden: vom rechten Anschluss der ersten Karte zur zweiten
  const first = cards.first()
  await first.hover()
  const handle = (await first.locator('.react-flow__handle-right').boundingBox())!
  const target = (await cards.nth(1).boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x + 4, target.y + target.height / 2, { steps: 12 })
  await page.mouse.up()
  await expect(canvas.locator('.react-flow__edge')).toHaveCount(1)
  // Beschriftung per Doppelklick auf den Pfeil
  await page.getByRole('button', { name: 'Bearbeiten (Enter)' }).click()
  await page.keyboard.type('bestimmt')
  await page.keyboard.press('Enter')
  await expect(canvas.locator('.canvas-edge-label')).toHaveText('bestimmt')

  // Farbe für die erste Karte
  await cards.first().click()
  await page.getByRole('button', { name: 'Farbe' }).click()
  await page.getByRole('menuitem', { name: 'Grün' }).click()
  await expect(cards.first()).toHaveClass(/has-color/)

  // Notiz als Karte einbetten – sie zeigt ihren Inhalt und öffnet sich per Klick auf den Titel
  await waitSaved(page)
  const created = await page.request.post('/api/notes', {
    headers: await apiHeaders(page),
    data: { title: 'Hauptsatz', content: 'Energie bleibt **erhalten**.' },
  })
  expect(created.status()).toBe(201)
  await page.reload()
  await page.getByRole('button', { name: 'Notiz oder Datei einfügen' }).click()
  await page.getByRole('dialog').getByPlaceholder('Suchen …').fill('Hauptsatz')
  await page.getByRole('dialog').getByRole('button', { name: 'Hauptsatz' }).click()
  const noteCard = canvas.getByTestId('canvas-file')
  await expect(noteCard.locator('strong')).toHaveText('erhalten')

  // Alles auswählen und gruppieren
  await canvas.click({ position: { x: 10, y: 10 } })
  await page.keyboard.press('ControlOrMeta+a')
  await page.getByRole('button', { name: 'Auswahl gruppieren' }).click()
  await page.keyboard.type('Kapitel 1')
  await page.keyboard.press('Enter')
  await expect(canvas.getByTestId('canvas-group')).toContainText('Kapitel 1')
  await waitSaved(page)
  await shot(page, '53-canvas')

  const saved = await savedNote(page, id)
  expect(saved.format).toBe('canvas')
  expect(saved.tags).toEqual(['physik'])
  const data = JSON.parse(saved.content) as {
    nodes: { type: string; text?: string; file?: string; label?: string; color?: string }[]
    edges: { fromSide: string; toSide: string; label: string }[]
  }
  expect(data.nodes.map((n) => n.type).sort()).toEqual(['file', 'group', 'text', 'text'])
  expect(data.nodes.find((n) => n.type === 'file')?.file).toBe('Hauptsatz')
  expect(data.nodes.find((n) => n.text?.startsWith('## Wärme'))?.color).toBe('4')
  expect(data.nodes.find((n) => n.type === 'group')?.label).toBe('Kapitel 1')
  expect(data.edges).toEqual([expect.objectContaining({ fromSide: 'right', toSide: 'left', label: 'bestimmt' })])

  // Die eingebettete Notiz verlinkt zurück
  const backlinks = await page.evaluate(async (title) => {
    const list = await fetch('/api/notes').then((r) => r.json())
    const target = list.notes.find((n: { title: string }) => n.title === title)
    return fetch(`/api/notes/${target.id}/backlinks`).then((r) => r.json())
  }, 'Hauptsatz')
  expect(backlinks.backlinks.map((b: { id: string }) => b.id)).toContain(id)

  // Lesemodus: nichts verschiebbar, der Titel der Notiz-Karte öffnet die Notiz
  await page.getByRole('radio', { name: 'Lesen' }).click()
  await expect(page.getByRole('toolbar', { name: 'Canvas' })).toHaveCount(0)
  await noteCard.getByRole('button', { name: 'Hauptsatz' }).click()
  await expect(page.getByTestId('note-title').or(page.getByRole('heading', { name: 'Hauptsatz' }))).toBeVisible()
})

test('Mindmap lässt sich als Canvas weiterbearbeiten', async ({ page }) => {
  await login(page)
  const id = await newNote(page, /Mindmap/, 'Projekt')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Planung')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Umsetzung')
  await page.keyboard.press('Enter')
  await waitSaved(page)
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click()
  await page.getByRole('menuitem', { name: /Format/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('radio', { name: /Canvas/ }).click()
  await expect(dialog.getByTestId('format-hint')).toContainText('Jeder Punkt wird eine Karte')
  await dialog.getByRole('button', { name: 'Umwandeln' }).click()
  const canvas = page.getByTestId('canvas')
  await expect(canvas.getByTestId('canvas-text')).toHaveCount(3)
  await expect(canvas.locator('.react-flow__edge')).toHaveCount(2)
  await shot(page, '54-mindmap-as-canvas')
  await expect.poll(async () => (await savedNote(page, id)).format, { timeout: 10_000 }).toBe('canvas')
})
