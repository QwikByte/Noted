import { expect, test, type Locator, type Page } from '@playwright/test'
import { apiHeaders, makePdf } from './helpers'

// Notizen und Ordner per Drag & Drop verschieben (Maus und Touch) und Dateien in der Ordnerstruktur der Notizen.

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

/** Mit der Maus von einem Element auf ein anderes ziehen – `name`: Bildschirmfoto kurz vor dem Loslassen */
async function mouseDrag(page: Page, from: Locator, to: Locator, name?: string) {
  const a = (await from.boundingBox())!
  const b = (await to.boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 })
  if (name) await shot(page, name)
  await page.mouse.up()
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

test('Notizen und Ordner ziehen, Dateien folgen ihren Notizen', async ({ page, browser }) => {
  await login(page)
  const headers = await apiHeaders(page)
  const folder = async (name: string, parentId: string | null = null) => {
    const f = (await (await page.request.post('/api/folders', { headers, data: { name, parentId } })).json()).folder
    cleanup.unshift(`/api/folders/${f.id}`)
    return f as { id: string }
  }
  const semester = await folder('Semester 3')
  const optimierung = await folder('Optimierung', semester.id)
  // Die Notiz liegt anfangs in einem Ordner – so steht sie oben in der Seitenleiste, egal welche Notizen andere Specs
  // im Konto hinterlassen haben
  const freizeit = await folder('Freizeit')
  const upload = async (name: string, buffer: Buffer, mimeType: string) => {
    const r = await page.request.post('/api/attachments', { headers, multipart: { file: { name, mimeType, buffer } } })
    const att = (await r.json()).attachment
    cleanup.push(`/api/attachments/${att.id}`)
    return att as { filename: string }
  }
  const pdf = await upload('Skript Simplex.pdf', makePdf([['Simplex']]), 'application/pdf')
  await upload('Ohne Bezug.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image/png')
  const content = `# Simplex\n\n![[${pdf.filename}]]\n`
  const data = { title: 'Simplex', content, folderId: freizeit.id }
  const note = (await (await page.request.post('/api/notes', { headers, data })).json()).note as { id: string }
  cleanup.unshift(`/api/notes/${note.id}?permanent=1`)
  const folderOf = async () => (await (await page.request.get(`/api/notes/${note.id}`)).json()).note.folderId
  await page.reload()

  // Seitenleiste: Notiz auf einen Ordner ziehen
  const tree = page.getByTestId('folder-tree').first()
  const semesterRow = tree.getByRole('button', { name: /^Semester 3/ })
  const freizeitRow = tree.getByRole('button', { name: /^Freizeit/ })
  await freizeitRow.click()
  await mouseDrag(page, tree.getByRole('link', { name: 'Simplex', exact: true }), semesterRow, '88-drag-note')
  await expect(page.getByText('„Simplex“ nach „Semester 3“ verschoben.')).toBeVisible()
  await expect.poll(folderOf).toBe(semester.id)
  // Der Ordner ist aufgeklappt, die Notiz steht darin
  await expect(semesterRow).toHaveAttribute('aria-expanded', 'true')

  // Ordner in einen Ordner ziehen – und rückgängig machen
  await mouseDrag(page, freizeitRow, semesterRow)
  await expect(page.getByText('Ordner „Freizeit“ nach „Semester 3“ verschoben.')).toBeVisible()
  await expect(tree.locator(`[data-drop-folder="${semester.id}"]`).getByRole('button', { name: /^Freizeit/ })).toBeVisible()
  await page.getByRole('button', { name: 'Rückgängig' }).last().click()
  await expect(tree.locator(`[data-drop-folder="${semester.id}"]`).getByRole('button', { name: /^Freizeit/ })).toHaveCount(0)

  // Ein Ordner lässt sich nicht in seinen Unterordner ziehen: keine Markierung, nichts passiert
  const semesterBox = (await semesterRow.boundingBox())!
  const optimierungBox = (await tree.getByRole('button', { name: /^Optimierung/ }).boundingBox())!
  await page.mouse.move(semesterBox.x + 20, semesterBox.y + semesterBox.height / 2)
  await page.mouse.down()
  const freizeitBox = (await freizeitRow.boundingBox())!
  await page.mouse.move(freizeitBox.x + 30, freizeitBox.y + freizeitBox.height / 2, { steps: 8 })
  await expect(page.getByTestId('drag-preview')).toContainText('Semester 3')
  await expect(freizeitRow.locator('xpath=../..')).toHaveClass(/outline-accent/)
  await page.mouse.move(optimierungBox.x + 30, optimierungBox.y + optimierungBox.height / 2, { steps: 8 })
  await expect(tree.locator(`[data-drop-folder="${optimierung.id}"]`)).not.toHaveClass(/outline-accent/)
  await expect(freizeitRow.locator('xpath=../..')).not.toHaveClass(/outline-accent/)
  await page.mouse.up()
  await expect(page.getByTestId('drag-preview')).toHaveCount(0)
  await expect(semesterRow).toBeVisible()

  // Dateien: in der Ordnerstruktur der Notizen, nicht eingebettete unter „Ohne Notiz“
  await page.getByRole('navigation').getByRole('link', { name: 'Dateien' }).first().click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dateien')
  const main = page.getByRole('main')
  await expect(main.getByRole('button', { name: /^Semester 3/ })).toContainText('1')
  await shot(page, '89-files')
  await main.getByRole('button', { name: /^Ohne Notiz/ }).click()
  await expect(main.getByTestId('file-card').filter({ hasText: 'Ohne Bezug.png' })).toBeVisible()
  await expect(main.getByTestId('file-card').filter({ hasText: pdf.filename })).toHaveCount(0)
  await main.getByRole('navigation', { name: 'Ordnerpfad' }).getByRole('button', { name: 'Dateien' }).click()
  await main.getByRole('button', { name: /^Semester 3/ }).click()
  const card = main.getByTestId('file-card').filter({ hasText: pdf.filename })
  await expect(card).toContainText('Simplex')
  await shot(page, '90-files-folder')
  // Ordner werden hier nicht verwaltet
  await expect(main.getByRole('button', { name: /Ordner/ })).toHaveCount(0)

  // Ordneransicht: Notiz aus der Liste auf einen Unterordner ziehen – die Datei zieht mit
  await page.goto(`/?f=${semester.id}`)
  const list = page.getByRole('main')
  await mouseDrag(page, list.getByRole('link', { name: /^Simplex/ }), list.getByRole('link', { name: /^Optimierung/ }))
  await expect.poll(folderOf).toBe(optimierung.id)
  await page.goto(`/?v=files&in=${optimierung.id}`)
  await expect(page.getByRole('main').getByTestId('file-card').filter({ hasText: pdf.filename })).toBeVisible()

  // Handy: langes Drücken auf die Notiz, dann auf den Ordner im Pfad ziehen
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: 'de-DE',
    storageState: await page.context().storageState(),
  })
  const mobile = await context.newPage()
  await mobile.goto(`/?f=${optimierung.id}`)
  const noteCard = mobile.getByRole('main').getByRole('link', { name: /^Simplex/ })
  const crumb = mobile.getByRole('main').getByRole('link', { name: 'Semester 3', exact: true })
  const a = (await noteCard.boundingBox())!
  const b = (await crumb.boundingBox())!
  const cdp = await context.newCDPSession(mobile)
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number, y?: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: x === undefined ? [] : [{ x, y: y! }] })
  const [x1, y1, x2, y2] = [a.x + 40, a.y + a.height / 2, b.x + b.width / 2, b.y + b.height / 2]
  await touch('touchStart', x1, y1)
  await mobile.waitForTimeout(600)
  await expect(mobile.getByTestId('drag-preview')).toContainText('Simplex')
  for (let t = 0.1; t <= 1.001; t += 0.1) await touch('touchMove', x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)
  await shot(mobile, '91-mobile-drag')
  await touch('touchEnd')
  await expect.poll(folderOf).toBe(semester.id)
  // Kein Öffnen der Notiz durch das Loslassen
  await expect(mobile).toHaveURL(new RegExp(`f=${optimierung.id}`))
  await context.close()
})

test('Mehrfachauswahl: auswählen, gemeinsam ziehen, in den Papierkorb und zurück', async ({ page, browser, context }) => {
  await login(page)
  const headers = await apiHeaders(page)
  const folder = async (name: string, parentId: string | null = null) => {
    const f = (await (await page.request.post('/api/folders', { headers, data: { name, parentId } })).json()).folder
    cleanup.unshift(`/api/folders/${f.id}`)
    return f as { id: string }
  }
  const semester = await folder('Auswahl Semester')
  const ziel = await folder('Auswahl Ziel', semester.id)
  const ids: string[] = []
  for (const title of ['Auswahl A', 'Auswahl B', 'Auswahl C']) {
    const data = { title, content: `Inhalt von ${title}`, folderId: semester.id }
    const note = (await (await page.request.post('/api/notes', { headers, data })).json()).note as { id: string }
    cleanup.unshift(`/api/notes/${note.id}?permanent=1`)
    ids.push(note.id)
  }
  const note = async (id: string) => (await (await page.request.get(`/api/notes/${id}`)).json()).note
  const folderIds = () => Promise.all(ids.map(async (id) => (await note(id))?.folderId ?? null))

  await page.goto(`/?f=${semester.id}`)
  const main = page.getByRole('main')
  const card = (title: string) => main.getByRole('link', { name: new RegExp(`^${title}`) })
  const bar = page.getByRole('toolbar', { name: 'Auswahl' })
  let tabs = 0
  context.on('page', () => tabs++)

  // Strg/⌘-Klick wählt aus statt die Notiz oder einen neuen Tab zu öffnen, Umschalt-Klick wählt einen Bereich
  await card('Auswahl A').click({ modifiers: ['ControlOrMeta'] })
  await expect(bar).toContainText('1 ausgewählt')
  await card('Auswahl C').click({ modifiers: ['Shift'] })
  await expect(bar).toContainText('3 ausgewählt')
  await card('Auswahl B').click({ modifiers: ['ControlOrMeta'] })
  await expect(bar).toContainText('2 ausgewählt')
  await card('Auswahl B').click({ modifiers: ['ControlOrMeta', 'Shift'] })
  await expect(bar).toContainText('3 ausgewählt')
  await expect(page).toHaveURL(new RegExp(`f=${semester.id}`))
  expect(tabs).toBe(0)
  await expect(main.getByRole('checkbox', { name: '„Auswahl B“ auswählen' })).toHaveAttribute('aria-checked', 'true')
  await shot(page, '95-selection')

  // Rechtsklick auf eine ausgewählte Notiz: die Sammelaktionen
  const menu = page.getByRole('menu', { name: 'Kontextmenü' })
  await card('Auswahl A').click({ button: 'right' })
  await expect(menu).toContainText('3 Notizen')
  await expect(menu.getByRole('menuitem', { name: 'Auswahl aufheben' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  // Esc schließt erst das Menü – die Auswahl bleibt
  await expect(bar).toContainText('3 ausgewählt')

  // Eine ausgewählte Notiz zieht alle mit – „Rückgängig“ legt jede zurück
  await mouseDrag(page, card('Auswahl B'), main.getByRole('link', { name: /^Auswahl Ziel/ }))
  await expect(page.getByText('3 Notizen nach „Auswahl Ziel“ verschoben.')).toBeVisible()
  await expect.poll(folderIds).toEqual([ziel.id, ziel.id, ziel.id])
  await expect(bar).toHaveCount(0)
  await page.getByRole('button', { name: 'Rückgängig' }).last().click()
  await expect.poll(folderIds).toEqual([semester.id, semester.id, semester.id])

  // Strg/⌘+A wählt alle Notizen (nicht den Unterordner), Esc hebt die Auswahl auf
  await main.getByRole('heading', { level: 1 }).click()
  await page.keyboard.press('ControlOrMeta+A')
  await expect(bar).toContainText('3 ausgewählt')
  await page.keyboard.press('Escape')
  await expect(bar).toHaveCount(0)

  // Über „Auswählen“: Klick auf die Karte schaltet um, zwei Notizen in den Papierkorb
  await main.getByRole('button', { name: 'Auswählen' }).click()
  await card('Auswahl A').click()
  await main.getByRole('checkbox', { name: '„Auswahl B“ auswählen' }).click()
  await expect(bar).toContainText('2 ausgewählt')
  await expect(page).toHaveURL(new RegExp(`f=${semester.id}`))
  await bar.getByRole('button', { name: 'In den Papierkorb' }).click()
  await expect(page.getByText('2 Notizen in den Papierkorb verschoben.')).toBeVisible()
  await expect(card('Auswahl A')).toHaveCount(0)
  expect((await page.request.get(`/api/notes/${ids[0]}`)).status()).toBe(404)

  // Im Papierkorb genau diese beiden auswählen und wiederherstellen
  await page.goto('/?v=trash')
  await main.getByRole('button', { name: 'Auswählen' }).click()
  await main.getByRole('checkbox', { name: '„Auswahl A“ auswählen' }).click()
  await main.getByRole('checkbox', { name: '„Auswahl B“ auswählen' }).click()
  await expect(bar).toContainText('2 ausgewählt')
  await bar.getByRole('button', { name: 'Wiederherstellen' }).click()
  await expect(page.getByText('2 Notizen wiederhergestellt.')).toBeVisible()
  await expect.poll(folderIds).toEqual([semester.id, semester.id, semester.id])

  // Handy: „Auswählen“, dann schaltet Tippen um, statt die Notiz zu öffnen
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: 'de-DE',
    storageState: await page.context().storageState(),
  })
  const mobile = await mobileContext.newPage()
  await mobile.goto(`/?f=${semester.id}`)
  const mobileMain = mobile.getByRole('main')
  await mobileMain.getByRole('button', { name: 'Auswählen' }).tap()
  await mobileMain.getByRole('link', { name: /^Auswahl A/ }).tap()
  await mobileMain.getByRole('link', { name: /^Auswahl C/ }).tap()
  await expect(mobile.getByRole('toolbar', { name: 'Auswahl' })).toContainText('2 ausgewählt')
  await expect(mobile).toHaveURL(new RegExp(`f=${semester.id}`))
  await shot(mobile, '96-mobile-selection')
  await mobileContext.close()
})

test('Sortierung: Ordner nach Name, Bearbeitung oder Erstellung – gemerkt, Auswahl folgt der Reihenfolge', async ({ page }) => {
  await login(page)
  const headers = await apiHeaders(page)
  const folder = (await (await page.request.post('/api/folders', { headers, data: { name: 'Sortierung' } })).json())
    .folder as { id: string }
  cleanup.unshift(`/api/folders/${folder.id}`)
  const ids: Record<string, string> = {}
  // Unterschiedliche Zeiten: erstellt in dieser Reihenfolge, zuletzt bearbeitet „Sort A“
  for (const title of ['Sort B 2', 'Sort A', 'Sort B 10']) {
    const data = { title, content: title, folderId: folder.id }
    ids[title] = ((await (await page.request.post('/api/notes', { headers, data })).json()).note as { id: string }).id
    cleanup.unshift(`/api/notes/${ids[title]}?permanent=1`)
    await page.waitForTimeout(20)
  }
  await page.request.put(`/api/notes/${ids['Sort A']}`, { headers, data: { content: 'Sort A bearbeitet' } })

  await page.goto(`/?f=${folder.id}`)
  const titles = () => page.getByRole('main').locator('a span.font-semibold').allTextContents()
  await expect.poll(titles).toEqual(['Sort A', 'Sort B 2', 'Sort B 10'])

  const sort = page.getByRole('button', { name: /^Sortieren:/ })
  await expect(sort).toHaveAccessibleName('Sortieren: Name, aufsteigend')
  await sort.click()
  await expect(page.getByRole('menuitemradio', { name: 'Name (A–Z)' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('menuitemradio', { name: 'Zuletzt bearbeitet (neueste zuerst)' }).click()
  await expect.poll(titles).toEqual(['Sort A', 'Sort B 10', 'Sort B 2'])
  await shot(page, '93-sort')

  // Mit der Tastatur: Pfeiltasten wandern durch die Einträge
  await sort.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menuitemradio', { name: 'Zuletzt bearbeitet (neueste zuerst)' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('menuitemradio', { name: 'Name (A–Z)' })).toBeFocused()
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitemradio', { name: 'Erstellt (neueste zuerst)' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(sort).toBeFocused()
  await expect.poll(titles).toEqual(['Sort B 10', 'Sort A', 'Sort B 2'])

  // Gemerkt nach dem Neuladen
  await page.reload()
  await expect.poll(titles).toEqual(['Sort B 10', 'Sort A', 'Sort B 2'])
  await expect(sort).toHaveAccessibleName('Sortieren: erstellt, neueste zuerst')

  // Umschalt-Klick wählt den sichtbaren Bereich
  const card = (title: string) => page.getByRole('main').getByRole('link', { name: new RegExp(`^${title}`) })
  await card('Sort B 10').click({ modifiers: ['Control'] })
  await card('Sort A').click({ modifiers: ['Shift'] })
  await expect(page.getByText('2 ausgewählt')).toBeVisible()
  await page.keyboard.press('Escape')
})

test('Suche: Phrase, Ausschluss und Ordnerfilter – die Wahl übersteht das Neuladen', async ({ page }) => {
  await login(page)
  const headers = await apiHeaders(page)
  const folder = (await (await page.request.post('/api/folders', { headers, data: { name: 'Suchfilter Mathe' } })).json())
    .folder as { id: string }
  cleanup.unshift(`/api/folders/${folder.id}`)
  for (const [title, content, folderId] of [
    ['Filter innen', 'Grenzwert einer Folge', folder.id],
    ['Filter außen', 'Folge einer Grenzwert-Rechnung', null],
  ] as const) {
    const n = (await (await page.request.post('/api/notes', { headers, data: { title, content, folderId } })).json()).note
    cleanup.unshift(`/api/notes/${n.id}?permanent=1`)
  }
  const titles = () => page.getByRole('main').locator('a span.font-semibold').allTextContents()

  await page.goto('/?q=grenzwert%20folge')
  await expect.poll(titles).toEqual(expect.arrayContaining(['Filter innen', 'Filter außen']))
  // Phrase: nur die Wortfolge
  await page.getByLabel('Suchbegriff').fill('"Grenzwert einer"')
  await expect.poll(titles).toEqual(['Filter innen'])
  // Ausschluss
  await page.getByLabel('Suchbegriff').fill('grenzwert -rechnung')
  await expect.poll(titles).toEqual(['Filter innen'])
  // Nur ausgeschlossen: Hinweis statt aller Notizen
  await page.getByLabel('Suchbegriff').fill('-rechnung')
  await expect(page.getByText('Gib mindestens ein Suchwort ein')).toBeVisible()

  await page.getByLabel('Suchbegriff').fill('grenzwert folge')
  await expect.poll(titles).toEqual(expect.arrayContaining(['Filter innen', 'Filter außen']))
  await page.getByLabel('Suchen in').selectOption(folder.id)
  await expect.poll(titles).toEqual(['Filter innen'])
  await expect(page).toHaveURL(new RegExp(`in=${folder.id}`))
  await expect(page.getByTestId('search-files-hidden')).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Suchen in')).toHaveValue(folder.id)
  await expect.poll(titles).toEqual(['Filter innen'])
})

test('Verlauf: älteren Stand ansehen und wiederherstellen', async ({ page }) => {
  await login(page)
  const headers = await apiHeaders(page)
  const content = '# Hauptsätze\n\nErster Hauptsatz'
  const data = { title: 'Verlauf Thermodynamik', content, folderId: null }
  const note = (await (await page.request.post('/api/notes', { headers, data })).json()).note as { id: string }
  cleanup.unshift(`/api/notes/${note.id}?permanent=1`)
  // Ein Formatwechsel sichert den bisherigen Stand sofort – beim Tippen erst nach 10 Minuten
  await page.request.put(`/api/notes/${note.id}`, { headers, data: { format: 'text', content: 'Hauptsätze' } })

  await page.goto(`/?n=${note.id}`)
  const editor = page.locator('.cm-content')
  await expect(editor).toContainText('Hauptsätze')
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('\nAus Versehen überschrieben')
  await expect(page.getByTestId('save-status')).toContainText('Gespeichert', { timeout: 10_000 })

  const openHistory = async () => {
    await page.getByRole('button', { name: 'Weitere Aktionen' }).click()
    await page.getByRole('menuitem', { name: 'Verlauf …' }).click()
  }
  await openHistory()
  const list = page.getByTestId('history-list')
  const preview = page.getByTestId('history-preview')
  await expect(list.getByRole('button')).toHaveCount(1)
  await expect(list).toContainText('Vor dem Formatwechsel')
  await expect(preview.getByRole('heading', { name: 'Hauptsätze' })).toBeVisible()
  await shot(page, '92-history')
  // Vergleich mit dem aktuellen Inhalt: was seitdem dazugekommen ist
  await page.getByRole('radio', { name: 'Änderungen bis heute' }).click()
  const diff = preview.getByTestId('diff-view')
  await expect(diff.locator('[data-kind="added"]', { hasText: 'Aus Versehen überschrieben' })).toHaveCount(1)
  await expect(diff.locator('[data-kind="removed"]', { hasText: 'Erster Hauptsatz' })).toHaveCount(1)
  await page.getByRole('radio', { name: 'Vorschau' }).click()
  await page.getByRole('button', { name: 'Diesen Stand wiederherstellen' }).click()
  const confirm = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Diesen Stand wiederherstellen?' }) })
  await confirm.getByRole('button', { name: 'Wiederherstellen', exact: true }).click()
  await expect(page.getByText(/^Stand vom .* wiederhergestellt\.$/)).toBeVisible()

  // Editor und Server zeigen wieder den alten Stand – samt Format
  await expect(editor).toContainText('# Hauptsätze')
  await expect(editor).not.toContainText('Aus Versehen')
  const restored = (await (await page.request.get(`/api/notes/${note.id}`)).json()).note
  expect(restored).toMatchObject({ format: 'markdown', content })

  // Der überschriebene Stand bleibt im Verlauf
  await openHistory()
  await expect(list.getByRole('button')).toHaveCount(2)
  await expect(list.getByRole('button').first()).toContainText('Vor dem Wiederherstellen')
  await expect(preview).toContainText('Aus Versehen überschrieben')
})

test('Graph: verlinkte Notizen sehen und per Klick öffnen', async ({ page }) => {
  await login(page)
  const headers = await apiHeaders(page)
  const create = async (title: string, content: string) => {
    const data = { title, content, folderId: null }
    const note = (await (await page.request.post('/api/notes', { headers, data })).json()).note as { id: string }
    cleanup.unshift(`/api/notes/${note.id}?permanent=1`)
    return note
  }
  const entropie = await create('Graph Entropie', 'Siehe [[Graph Wärme]] und [[Gibt es nicht]]')
  const waerme = await create('Graph Wärme', 'Zurück zu [[Graph Entropie]]')
  await page.reload()

  await page.getByRole('navigation').getByRole('link', { name: 'Graph' }).click()
  await expect(page).toHaveURL(/v=graph/)
  const graph = page.getByTestId('graph')
  await expect(graph.getByTestId(`rf__node-${entropie.id}`)).toBeVisible()
  await expect(graph.getByTestId(`rf__edge-${entropie.id}>${waerme.id}`)).toBeAttached()
  await expect(graph.getByTestId(`rf__edge-${waerme.id}>${entropie.id}`)).toBeAttached()
  // Die Suche hebt Treffer hervor und zeigt ihren Titel auch beim Herauszoomen
  await page.getByLabel('Notiz im Graphen hervorheben').fill('wärme')
  await expect(graph.getByTestId(`rf__node-${waerme.id}`).locator('.graph-match')).toContainText('Graph Wärme')
  await shot(page, '93-graph')
  await graph.getByTestId(`rf__node-${waerme.id}`).click()
  await expect(page.getByTestId('note-title')).toHaveValue('Graph Wärme')

  // Lokaler Graph im Lesemodus: die verlinkte Notiz anklicken öffnet sie
  await page.getByRole('radio', { name: 'Lesen' }).click()
  await page.getByRole('button', { name: 'Lokaler Graph' }).click()
  const local = page.getByTestId('graph')
  await expect(local.getByTestId(`rf__node-${waerme.id}`).locator('.graph-center')).toBeVisible()
  await expect(local.locator('.react-flow__node')).toHaveCount(2)
  await shot(page, '94-local-graph')
  await local.getByTestId(`rf__node-${entropie.id}`).click()
  await expect(page.getByTestId('note-title')).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 1, name: 'Graph Entropie' })).toBeVisible()
})

test('Notiz per Link teilen: Gäste lesen ohne Konto, nach dem Widerruf ist der Link tot', async ({ page, browser }) => {
  await login(page)
  const headers = await apiHeaders(page)
  // 1×1-PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
  const up = await page.request.post('/api/attachments', { headers, multipart: { file: { name: 'Teilbild.png', mimeType: 'image/png', buffer: png } } })
  const att = (await up.json()).attachment as { id: string; filename: string }
  cleanup.push(`/api/attachments/${att.id}`)
  const content = [
    '# Zusammenfassung',
    '',
    `Für die Lerngruppe ![[${att.filename}]]`,
    '',
    'Mehr in [[Private Notiz]].',
    '',
    '<script>window.__xss = 1</script><img src="x" onerror="window.__xss = 2">',
  ].join('\n')
  const data = { title: 'Für Kommilitonen', content, folderId: null }
  const note = (await (await page.request.post('/api/notes', { headers, data })).json()).note as { id: string }
  cleanup.unshift(`/api/notes/${note.id}?permanent=1`)

  await page.goto(`/?n=${note.id}`)
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click()
  await page.getByRole('menuitem', { name: 'Teilen …' }).click()
  await page.getByRole('radio', { name: '7 Tage' }).click()
  await page.getByRole('button', { name: 'Link erstellen' }).click()
  const url = await page.getByTestId('share-url').inputValue()
  expect(url).toMatch(/\/s\/[A-Za-z0-9_-]{43}$/)
  await expect(page.getByTestId('share-list')).toContainText('gültig bis')
  await shot(page, '95-share-dialog')

  // Gast ohne Konto
  const guest = await browser.newContext({ locale: 'de-DE' })
  const g = await guest.newPage()
  const res = await g.goto(url)
  expect(res?.status()).toBe(200)
  expect(res?.headers()['x-robots-tag']).toContain('noindex')
  await expect(g.getByTestId('shared-title')).toHaveText('Für Kommilitonen')
  const view = g.getByTestId('shared-content')
  await expect(view.getByRole('heading', { name: 'Zusammenfassung' })).toBeVisible()
  const img = view.locator('img.embed-image')
  await expect(img).toHaveAttribute('src', /\/api\/s\/.+\/files\/Teilbild\.png$/)
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1)
  // Links auf andere Notizen sind reiner Text, Skripte aus der Notiz laufen nie
  await expect(view.getByText('Private Notiz')).toBeVisible()
  await expect(view.locator('a', { hasText: 'Private Notiz' })).toHaveCount(0)
  await expect(view.locator('script, [onerror]')).toHaveCount(0)
  expect(await g.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined()
  await shot(g, '96-shared-note')

  // Widerrufen erst nach Rückfrage – Escape schließt nur die Rückfrage, nicht den Teilen-Dialog dahinter
  await page.getByTestId('share-list').getByRole('button', { name: 'Widerrufen' }).click()
  const confirm = page.getByRole('dialog', { name: 'Link widerrufen?' })
  await expect(confirm).toContainText('„Für Kommilitonen“')
  await page.keyboard.press('Escape')
  await expect(confirm).toHaveCount(0)
  await expect(page.getByTestId('share-list')).toBeVisible()
  // Danach: Der Link führt ins Leere
  await page.getByTestId('share-list').getByRole('button', { name: 'Widerrufen' }).click()
  await confirm.getByRole('button', { name: 'Widerrufen' }).click()
  await expect(page.getByText('Link widerrufen')).toBeVisible()
  const gone = await g.goto(url)
  expect(gone?.status()).toBe(404)
  await expect(g.getByRole('heading', { name: 'Seite nicht gefunden' })).toBeVisible()
  await guest.close()
})

test('Links ins Leere: ungültige Zeichen fragen nach, ein Ordnerpfad legt im Ordner an', async ({ page }) => {
  await login(page)
  const headers = await apiHeaders(page)
  const folder = (await (await page.request.post('/api/folders', { headers, data: { name: 'Physik Linkziele' } })).json()).folder
  cleanup.unshift(`/api/folders/${folder.id}`)
  const note = (
    await (
      await page.request.post('/api/notes', {
        headers,
        data: { title: 'Linkziele', content: '[[Was ist Entropie?]] und [[Physik Linkziele/Wellen Linkziele]]' },
      })
    ).json()
  ).note
  cleanup.unshift(`/api/notes/${note.id}?permanent=1`)
  const titles = async () =>
    ((await (await page.request.get('/api/notes')).json()).notes as { title: string; folderId: string | null; id: string }[])
      .filter((n) => n.title.includes('Entropie') || n.title.includes('Wellen'))

  await page.goto(`/?n=${note.id}`)
  await page.getByRole('radio', { name: 'Lesen' }).click()

  // Ungültiges Zeichen: kein Entwurf, der beim Speichern scheitert, sondern der Dialog mit bereinigtem Titel
  await page.locator('.markdown-body a.wikilink.unresolved', { hasText: 'Was ist Entropie?' }).click()
  const dialog = page.getByRole('dialog', { name: 'Neue Notiz' })
  await expect(dialog.getByLabel('Titel')).toHaveValue('Was ist Entropie-')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.markdown-body')).toBeVisible()
  expect(await titles()).toEqual([])

  // Ordner/Titel: „Wellen Linkziele“ im Ordner „Physik Linkziele“, der Link ist danach aufgelöst
  await page.locator('.markdown-body a.wikilink.unresolved', { hasText: 'Wellen Linkziele' }).click()
  await expect.poll(async () => (await titles()).map((n) => [n.title, n.folderId])).toEqual([['Wellen Linkziele', folder.id]])
  cleanup.unshift(`/api/notes/${(await titles())[0].id}?permanent=1`)
  await page.goto(`/?n=${note.id}`)
  await expect(page.locator('.markdown-body a.wikilink', { hasText: 'Wellen Linkziele' })).not.toHaveClass(/unresolved/)
})

test('Gleichnamige Notizen: Links mit Ordner öffnen die Notiz dort, ohne Ordner zuerst die im eigenen', async ({ page }) => {
  await login(page)
  const headers = await apiHeaders(page)
  const folder = async (name: string) => {
    const f = (await (await page.request.post('/api/folders', { headers, data: { name } })).json()).folder
    cleanup.unshift(`/api/folders/${f.id}`)
    return f as { id: string }
  }
  const create = async (title: string, content: string, folderId: string | null) => {
    const note = (await (await page.request.post('/api/notes', { headers, data: { title, content, folderId } })).json()).note
    cleanup.unshift(`/api/notes/${note.id}?permanent=1`)
    return note as { id: string }
  }
  const ana = await folder('Analysis Pfadlink')
  const la = await folder('LA Pfadlink')
  const inAna = await create('Übung Pfadlink', 'Folgen', ana.id)
  const plan = await create('Lernplan Pfadlink', '[[Analysis Pfadlink/Übung Pfadlink]] und [[Übung Pfadlink]]', null)
  const nearby = await create('Mitschrift Pfadlink', '[[Übung Pfadlink]]', ana.id)
  // Zuletzt bearbeitet wird die Übung aus Lineare Algebra
  const inLa = await create('Übung Pfadlink', 'Matrizen', la.id)
  const links = page.locator('.markdown-body a.wikilink')

  // Mit Ordner: die Übung aus Analysis, auch wenn die andere zuletzt bearbeitet wurde; ohne Ordner wie bisher
  await page.goto(`/?n=${plan.id}`)
  await page.getByRole('radio', { name: 'Lesen' }).click()
  await expect(links.nth(0)).toHaveAttribute('data-note-id', inAna.id)
  await expect(links.nth(1)).toHaveAttribute('data-note-id', inLa.id)
  await links.nth(0).click()
  await expect(page).toHaveURL(new RegExp(`n=${inAna.id}`))
  await expect(page.locator('.markdown-body')).toContainText('Folgen')

  // Ohne Ordner aus einer Notiz im Ordner Analysis: die Übung daneben
  await page.goto(`/?n=${nearby.id}`)
  await expect(links.first()).toHaveAttribute('data-note-id', inAna.id)

  // Umbenennen: Der Link mit Ordner und der aus dem Ordner folgen, der mehrdeutige bleibt – mit Hinweis
  await page.goto(`/?n=${inAna.id}`)
  await page.getByRole('radio', { name: 'Bearbeiten' }).click()
  await page.getByTestId('note-title').fill('Folgen Pfadlink')
  await page.getByTestId('note-title').press('Enter')
  await expect(page.getByText('2 Links auf „Folgen Pfadlink“ aktualisiert.')).toBeVisible()
  await expect(page.getByText('1 Link ohne Ordner blieb unverändert – es gibt noch eine Notiz mit dem alten Titel.')).toBeVisible()
  const content = async (id: string) => (await (await page.request.get(`/api/notes/${id}`)).json()).note.content
  expect(await content(plan.id)).toBe('[[Analysis Pfadlink/Folgen Pfadlink]] und [[Übung Pfadlink]]')
  expect(await content(nearby.id)).toBe('[[Folgen Pfadlink]]')
})

test('Editor: Links per Strg-Klick öffnen, Vorschau beim Überfahren, Kontextmenü', async ({ page }) => {
  await login(page)
  const headers = await apiHeaders(page)
  const create = async (title: string, content: string) => {
    const note = (await (await page.request.post('/api/notes', { headers, data: { title, content } })).json()).note
    cleanup.unshift(`/api/notes/${note.id}?permanent=1`)
    return note as { id: string }
  }
  const target = await create('Analysis Linkziel', '## Grenzwerte\n\nEine Folge konvergiert, wenn …\n')
  const source = await create('Linkquelle', 'Siehe [[Analysis Linkziel#Grenzwerte]] und #klausurlink sowie `[[Analysis Linkziel]]`\n')
  await page.goto(`/?n=${source.id}`)
  await page.getByRole('radio', { name: 'Bearbeiten' }).click()
  const link = page.locator('.cm-content .cm-md-wikilink', { hasText: 'Analysis Linkziel#Grenzwerte' })
  await expect(link).toBeVisible()

  // Vorschau beim Überfahren: Titel und Auszug
  await link.hover()
  const preview = page.locator('.cm-tooltip-hover .cm-link-preview')
  await expect(preview).toContainText('Analysis Linkziel')
  await expect(preview).toContainText('› Grenzwerte')
  await expect(preview).toContainText('Eine Folge konvergiert')

  // Ein normaler Klick setzt nur den Cursor
  await link.click()
  await expect(page).toHaveURL(new RegExp(source.id))

  // Rechtsklick auf den Tag
  await page.locator('.cm-content .cm-md-tag', { hasText: '#klausurlink' }).click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Tag „#klausurlink“ anzeigen' })).toBeVisible()
  await page.keyboard.press('Escape')

  // Strg-Klick öffnet die Notiz
  await link.click({ modifiers: ['Control'] })
  await expect(page).toHaveURL(new RegExp(target.id))
  await expect(page.getByTestId('note-title')).toHaveValue('Analysis Linkziel')
})
