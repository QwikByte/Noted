import { expect, test, type Page } from '@playwright/test'
import { apiHeaders } from './helpers'

// Oberfläche: Notiz als Blatt Papier, Menüs in scrollenden Werkzeugleisten, Rückfrage vor dem endgültigen Löschen

const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'E2E-Admin-Passwort-1'

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Benutzername').fill('admin')
  await page.getByLabel('Passwort', { exact: true }).fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Administrator')
}

async function createNote(page: Page, title: string, content: string) {
  const res = await page.request.post('/api/notes', { headers: await apiHeaders(page), data: { title, content } })
  expect(res.ok()).toBeTruthy()
  return ((await res.json()) as { note: { id: string } }).note.id
}

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

const paperStyle = (page: Page) =>
  page.locator('.note-paper').first().evaluate((el) => {
    const s = getComputedStyle(el)
    const desk = getComputedStyle(el.closest('.note-desk')!)
    return { bg: s.backgroundColor, color: s.color, border: s.borderTopColor, borderWidth: s.borderTopWidth, desk: desk.backgroundColor }
  })

test('Notiz liegt als Blatt auf dem Tisch – im dunklen Design hell, im hellen mit sichtbarem Rand', async ({ page }) => {
  await login(page)
  const id = await createNote(page, 'Blatt Papier', 'Ein Absatz auf dem Blatt.\n\n```js\nconst a = 1 // Kommentar\n```\n')

  await page.evaluate(() => {
    localStorage.setItem('noted:theme', 'dark')
    localStorage.setItem('noted:mode', 'read')
  })
  await page.goto(`/?n=${id}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Blatt Papier' })).toBeVisible()
  const dark = await paperStyle(page)
  expect(dark.bg).toBe('rgb(255, 255, 255)')
  // Dunkle Schrift auf dem hellen Blatt, der Tisch drumherum bleibt dunkel
  expect(dark.color).toBe('rgb(26, 32, 48)')
  expect(dark.desk).not.toBe('rgb(255, 255, 255)')
  // Die Statusleiste der App folgt dem gewählten Design, nicht dem System
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute('content', '#151821')

  await page.getByRole('radio', { name: 'Bearbeiten' }).click()
  await expect(page.locator('.note-paper .cm-content')).toBeVisible()
  expect((await paperStyle(page)).bg).toBe('rgb(255, 255, 255)')

  await page.evaluate(() => localStorage.setItem('noted:theme', 'light'))
  await page.reload()
  await expect(page.locator('.note-paper .cm-content')).toBeVisible()
  const light = await paperStyle(page)
  expect(light.bg).toBe('rgb(255, 255, 255)')
  expect(light.borderWidth).toBe('1px')
  expect(light.border).not.toBe('rgba(0, 0, 0, 0)')
  expect(light.desk).not.toBe(light.bg)
})

test('Menüs der Werkzeugleiste werden nicht abgeschnitten – auch auf dem Handy', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const page = await context.newPage()
  page.on('pageerror', (err) => consoleErrors.push(String(err)))
  await login(page)
  const id = await createNote(page, 'Menü im Editor', 'Abschnitt')
  await page.evaluate(() => localStorage.setItem('noted:mode', 'edit'))
  await page.goto(`/?n=${id}`)
  await page.locator('.cm-content').click()

  // Die Leiste scrollt waagerecht – ein Menü darin lag bisher unsichtbar in ihrem Ausschnitt
  await page.getByRole('toolbar', { name: 'Formatierung' }).getByRole('button', { name: 'Überschrift' }).click()
  const item = page.getByRole('menuitem', { name: 'Überschrift 2' })
  await expect(item).toBeInViewport()
  await item.click()
  await expect(page.locator('.cm-content')).toContainText('## Abschnitt')
  await context.close()
})

test('Dialoge: Eingabefeld hat beim Öffnen den Fokus, Markieren über den Rand schließt nicht', async ({ page }) => {
  await login(page)
  await page.getByRole('button', { name: 'Neuer Ordner' }).click()
  const dialog = page.getByRole('dialog', { name: 'Neuer Ordner' })
  const name = dialog.getByLabel('Name')
  // autoFocus griff bisher nicht, weil der Inhalt vor dem Öffnen des <dialog> eingehängt wurde
  await expect(name).toBeFocused()
  await page.keyboard.type('Lineare Algebra')

  // Text markieren und die Maus außerhalb des Dialogs loslassen: Das ist kein Klick auf den Hintergrund
  const box = (await name.boundingBox())!
  await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(5, 5)
  await page.mouse.up()
  await expect(dialog).toBeVisible()
  await expect(name).toHaveValue('Lineare Algebra')

  // Ein echter Klick auf den Hintergrund schließt weiterhin
  await page.mouse.click(5, 5)
  await expect(dialog).toHaveCount(0)
})

test('Kontextmenüs: Notiz in der Seitenleiste, Editor, freie Fläche und Tastatur', async ({ page }) => {
  await login(page)
  const id = await createNote(page, 'Kontextnotiz', 'wichtig')
  await page.goto('/')
  const menu = page.getByRole('menu', { name: 'Kontextmenü' })
  const sidebarNote = page.getByRole('complementary').getByRole('link', { name: 'Kontextnotiz', exact: true })

  // Rechtsklick auf eine Notiz: dieselben Aktionen wie im Menü „…“, dazu Öffnen
  await sidebarNote.click({ button: 'right' })
  await expect(menu.getByRole('menuitem', { name: 'In neuem Tab öffnen' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'In den Papierkorb' })).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Anheften' }).click()
  await expect(menu).toHaveCount(0)
  await sidebarNote.click({ button: 'right' })
  await expect(menu.getByRole('menuitem', { name: 'Lösen' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)

  // Mit der Tastatur: Fokus auf den ersten Eintrag, Pfeiltasten wandern weiter
  await sidebarNote.focus()
  await page.keyboard.press('Shift+F10')
  await expect(menu.getByRole('menuitem', { name: 'Öffnen', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: 'In neuem Tab öffnen' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(sidebarNote).toBeFocused()

  // Freie Fläche im Hauptbereich (hier die Begrüßung): neu anlegen
  await page.getByRole('main').getByRole('heading', { level: 1 }).click({ button: 'right' })
  await menu.getByRole('menuitem', { name: 'Neue Notiz …' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')

  // Im Editor: markierten Text fett machen
  await page.evaluate(() => localStorage.setItem('noted:mode', 'edit'))
  await page.goto(`/?n=${id}`)
  const editor = page.locator('.cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+A')
  await editor.click({ button: 'right' })
  await expect(menu.getByRole('menuitem', { name: 'Ausschneiden' })).toBeEnabled()
  await menu.getByRole('menuitem', { name: 'Fett' }).click()
  await expect(editor).toContainText('**wichtig**')
})

test('Navigation: Notizen und Ansichten sind echte Links – Strg-Klick öffnet einen neuen Tab', async ({ page, context }) => {
  await login(page)
  const id = await createNote(page, 'Verlinkte Notiz', 'Inhalt')
  await page.goto('/')
  const sidebar = page.getByRole('complementary')
  const noteLink = sidebar.getByRole('link', { name: 'Verlinkte Notiz', exact: true })
  await expect(noteLink).toHaveAttribute('href', `/?n=${id}`)
  await expect(sidebar.getByRole('link', { name: 'Papierkorb' })).toHaveAttribute('href', '/?v=trash')

  // Strg/⌘-Klick: neuer Tab, die Ansicht hier bleibt
  const [tab] = await Promise.all([context.waitForEvent('page'), noteLink.click({ modifiers: ['ControlOrMeta'] })])
  await tab.waitForLoadState()
  expect(new URL(tab.url()).searchParams.get('n')).toBe(id)
  await expect(page).toHaveURL(/\/$/)
  await tab.close()

  // Normaler Klick: Wechsel ohne Neuladen
  await page.evaluate(() => ((window as { __noReload?: boolean }).__noReload = true))
  await noteLink.click()
  await expect(page.getByTestId('note-title').or(page.getByRole('heading', { name: 'Verlinkte Notiz' }))).toBeVisible()
  expect(await page.evaluate(() => (window as { __noReload?: boolean }).__noReload)).toBe(true)
})

test('Meldungen erscheinen über einem offenen Dialog und lassen sich bedienen', async ({ page }) => {
  await login(page)
  const id = await createNote(page, 'Zum Teilen', 'Für die Lerngruppe.')
  await page.goto(`/?n=${id}`)
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click()
  await page.getByRole('menuitem', { name: 'Teilen …' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Link erstellen' }).click()
  await dialog.getByRole('button', { name: 'Kopieren' }).click()
  // Bisher lag die Meldung gedimmt unter dem Hintergrund des Dialogs und ließ sich nicht anklicken
  const toast = dialog.getByRole('status').filter({ hasText: 'Link kopiert.' })
  await expect(toast).toBeVisible()
  await toast.getByRole('button', { name: 'Schließen' }).click()
  await expect(toast).toHaveCount(0)
  await expect(dialog).toBeVisible()
})

test('Offline: Die Editoren werden erst nachgeladen, wenn wieder Netz da ist', async ({ page, context }) => {
  await page.clock.install()
  await login(page)
  const failed: string[] = []
  page.on('requestfailed', (r) => failed.push(r.url()))
  await context.setOffline(true)
  // Nach 5 s lädt die App Editoren für den Offline-Betrieb nach – offline schlug das bisher fehl
  await page.clock.runFor(6_000)
  await page.waitForTimeout(500)
  expect(failed).toEqual([])
  await context.setOffline(false)
  const chunk = page.waitForRequest(/\/_next\/static\/chunks\//)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await chunk
})

test('Papierkorb: endgültig löschen erst nach Rückfrage', async ({ page }) => {
  await login(page)
  const id = await createNote(page, 'Wegwerfnotiz', 'Kann weg.')
  const res = await page.request.delete(`/api/notes/${id}`, { headers: await apiHeaders(page) })
  expect(res.ok()).toBeTruthy()

  await page.goto('/?v=trash')
  await page.getByRole('button', { name: '„Wegwerfnotiz“ endgültig löschen' }).click()
  const dialog = page.getByRole('dialog', { name: 'Endgültig löschen?' })
  await expect(dialog).toContainText('„Wegwerfnotiz“ wird endgültig gelöscht.')
  // Abbrechen lässt die Notiz liegen
  await dialog.getByRole('button', { name: 'Abbrechen' }).click()
  await expect(page.getByText('Wegwerfnotiz', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '„Wegwerfnotiz“ endgültig löschen' }).click()
  await page.getByRole('dialog', { name: 'Endgültig löschen?' }).getByRole('button', { name: 'Endgültig löschen' }).click()
  await expect(page.getByText('Der Papierkorb ist leer.')).toBeVisible()
})
