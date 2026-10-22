import { expect, test, type Page } from '@playwright/test'
import { apiHeaders } from './helpers'

// Tresor: einrichten, verschlüsselt schreiben (nichts davon im Klartext auf Server oder Gerät), sperren und entsperren,
// Passwort und Wiederherstellungsschlüssel, Manipulation, offline, automatisch sperren, mehrere Tabs, löschen.

const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'E2E-Admin-Passwort-1'
const SHOTS = process.env.SCREENSHOT_DIR
const MARKER = 'quokkageheimnis'
const PASSWORD = 'Ein Satz als Tresor-Passwort'
const NEW_PASSWORD = 'Ein anderer Satz als Passwort'

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

const vaultFolder = (page: Page) =>
  page.getByTestId('folder-tree').getByRole('button', { name: /^Tresor( \(gesperrt\))?$/ })

/** Über den Ordner „Tresor“ in der Seitenleiste entsperren */
async function unlock(page: Page, password = PASSWORD) {
  await vaultFolder(page).click()
  const dialog = page.getByRole('dialog', { name: 'Tresor entsperren' })
  await dialog.getByLabel('Tresor-Passwort').fill(password)
  await dialog.getByRole('button', { name: 'Entsperren', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 15_000 })
}

/** Alles, was die App im Browser speichert: localStorage und die Caches des Service Workers */
function storedOnDevice(page: Page) {
  return page.evaluate(async () => {
    const parts = Object.keys(localStorage).map((k) => `${k}=${localStorage.getItem(k)}`)
    for (const name of await caches.keys()) {
      const cache = await caches.open(name)
      for (const req of await cache.keys()) {
        if (!req.url.includes('/api/')) continue
        const res = await cache.match(req)
        parts.push(`${req.url}=${res ? await res.text() : ''}`)
      }
    }
    return parts.join('\n')
  })
}

let consoleErrors: string[] = []
test.beforeEach(({ page }) => {
  consoleErrors = []
  page.on('console', (msg) => {
    // Offline schlagen Anfragen erwartungsgemäß fehl
    const expected = /status of (401|403|404|409)|ERR_INTERNET_DISCONNECTED/
    if (msg.type() === 'error' && !expected.test(msg.text())) consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(String(err)))
})
test.afterEach(() => {
  expect(consoleErrors, 'Fehler in der Browser-Konsole').toEqual([])
})

test.describe.configure({ mode: 'serial' })

let recoveryKey = ''
let noteId = ''

test('Tresor einrichten und verschlüsselt schreiben – nichts davon im Klartext', async ({ page }) => {
  await login(page)
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Tresor einrichten' }).click()
  const dialog = page.getByRole('dialog', { name: 'Tresor einrichten' })
  await dialog.getByLabel('Tresor-Passwort', { exact: true }).fill('zu kurz')
  await dialog.getByLabel('Passwort wiederholen').fill('zu kurz')
  await dialog.getByRole('button', { name: 'Weiter' }).click()
  await expect(dialog.getByRole('alert')).toContainText('mindestens 12 Zeichen')
  await dialog.getByLabel('Tresor-Passwort', { exact: true }).fill(PASSWORD)
  await dialog.getByLabel('Passwort wiederholen').fill(PASSWORD)
  await dialog.getByRole('button', { name: 'Weiter' }).click()

  // Wiederherstellungsschlüssel zeigen, dann eine Gruppe daraus bestätigen
  recoveryKey = (await dialog.getByTestId('recovery-key').textContent({ timeout: 15_000 }))!.trim()
  expect(recoveryKey).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/)
  await shot(page, '60-vault-recovery-key')
  await dialog.getByRole('button', { name: 'Weiter' }).click()
  const groupField = dialog.getByLabel(/Gruppe deines Wiederherstellungsschlüssels/)
  const label = (await dialog.getByText(/Gruppe deines Wiederherstellungsschlüssels/).textContent())!
  const group = Number(label.match(/^(\d)\./)![1])
  await groupField.fill('XXXX')
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button', { name: 'Tresor anlegen' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Die Gruppe stimmt nicht')
  await groupField.fill(recoveryKey.split('-')[group - 1].toLowerCase())
  await dialog.getByRole('button', { name: 'Tresor anlegen' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Entsperrt in diesem Tab')).toBeVisible()

  // Ohne Neuladen zurück zu den Notizen – der Tresor bleibt in diesem Tab offen
  await page.getByRole('link', { name: 'Zurück zu den Notizen' }).click()
  await vaultFolder(page).click()
  await expect(vaultFolder(page)).toHaveAttribute('aria-expanded', 'true')
  await vaultFolder(page).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Neuer Unterordner' }).click()
  await page.getByRole('dialog').getByLabel('Name').fill(`Ordner ${MARKER}`)
  await page.getByRole('dialog').getByRole('button', { name: 'Anlegen' }).click()
  await expect(page.getByTestId('folder-tree').getByText(`Ordner ${MARKER}`)).toBeVisible()

  await vaultFolder(page).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Neue Notiz hier' }).click()
  await page.getByRole('dialog').getByLabel('Titel').fill(`Titel ${MARKER}`)
  await page.getByRole('dialog').getByRole('button', { name: 'Erstellen' }).click()
  await expect(page.getByText('Im Tresor')).toBeVisible()
  await page.locator('.cm-content').click()
  await page.keyboard.insertText(`Inhalt ${MARKER}\n\n## Abschnitt\n\nText`)
  await expect(page.getByTestId('save-status')).toContainText('Gespeichert', { timeout: 10_000 })
  noteId = new URL(page.url()).searchParams.get('n')!
  await shot(page, '61-vault-note')

  // Server: nur Umschläge, keine Suche, keine Tags
  const fromServer = await page.evaluate(async (id) => {
    const urls = ['/api/notes', `/api/notes/${id}`, '/api/folders', '/api/tags', '/api/graph', '/api/glossary']
    const texts = await Promise.all(urls.map((u) => fetch(u).then((r) => r.text())))
    const search = await fetch(`/api/search?q=quokkageheimnis`).then((r) => r.json())
    return { texts, search }
  }, noteId)
  for (const text of fromServer.texts) expect(text).not.toContain(MARKER)
  expect(fromServer.texts[1]).toMatch(/"content":"nv1\./)
  expect(fromServer.search.results).toEqual([])

  // Gerät: weder im localStorage noch in den Caches des Service Workers
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
  await page.reload()
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)
  await page.evaluate((id) => fetch(`/api/notes/${id}`).then((r) => r.text()), noteId)
  const stored = await storedOnDevice(page)
  expect(stored).toContain(`/api/notes/${noteId}`)
  expect(stored).not.toContain(MARKER)
})

test('Sperren und entsperren – Neuladen sperrt, falsches Passwort öffnet nichts', async ({ page }) => {
  await login(page)
  await page.goto(`/?n=${noteId}`)
  // Neu geladen ist der Tresor gesperrt: kein Inhalt, keine Unterordner
  await expect(page.getByTestId('vault-note-locked')).toBeVisible()
  await expect(page.getByTestId('folder-tree').getByText(`Ordner ${MARKER}`)).toHaveCount(0)
  await shot(page, '62-vault-locked')

  await page.getByTestId('vault-note-locked').getByRole('button', { name: 'Entsperren', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Tresor entsperren' })
  await dialog.getByLabel('Tresor-Passwort').fill('Das ist nicht das Passwort')
  await dialog.getByRole('button', { name: 'Entsperren', exact: true }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Das Passwort stimmt nicht.', { timeout: 15_000 })
  await expect(page.locator('.cm-content')).toHaveCount(0)
  await dialog.getByLabel('Tresor-Passwort').fill(PASSWORD)
  await dialog.getByRole('button', { name: 'Entsperren', exact: true }).click()
  await expect(page.locator('.cm-content')).toContainText(`Inhalt ${MARKER}`, { timeout: 15_000 })
  await expect(page.getByTestId('note-title')).toHaveValue(`Titel ${MARKER}`)
  await expect(page.getByTestId('folder-tree').getByText(`Ordner ${MARKER}`)).toBeVisible()

  // Sperren über die Seitenleiste schließt die Notiz
  await page.getByRole('button', { name: 'Tresor sperren' }).click()
  await expect(page.getByTestId('vault-note-locked')).toBeVisible()
  await expect(page.locator('.cm-content')).toHaveCount(0)
  await expect(page.getByTestId('folder-tree')).not.toContainText(MARKER)
})

test('Passwort ändern und mit dem Wiederherstellungsschlüssel entsperren', async ({ page }) => {
  await login(page)
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Passwort ändern …' }).click()
  let dialog = page.getByRole('dialog', { name: 'Tresor-Passwort ändern' })
  await dialog.getByLabel('Bisheriges Tresor-Passwort').fill(PASSWORD)
  await dialog.getByLabel('Neues Tresor-Passwort').fill(NEW_PASSWORD)
  await dialog.getByLabel('Passwort wiederholen').fill(NEW_PASSWORD)
  await dialog.getByRole('button', { name: 'Ändern' }).click()
  await expect(dialog).toBeHidden({ timeout: 15_000 })
  // Nur neu verpackt: Die Notiz hat dieselbe Version wie vorher
  const version = await page.evaluate((id) => fetch(`/api/notes/${id}`).then((r) => r.json()), noteId)

  await page.getByRole('link', { name: 'Zurück zu den Notizen' }).click()
  await vaultFolder(page).click()
  dialog = page.getByRole('dialog', { name: 'Tresor entsperren' })
  await dialog.getByLabel('Tresor-Passwort').fill(PASSWORD)
  await dialog.getByRole('button', { name: 'Entsperren', exact: true }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Das Passwort stimmt nicht.', { timeout: 15_000 })

  // Passwort vergessen: Wiederherstellungsschlüssel – klein und ohne Bindestriche – und ein neues Passwort
  await dialog.getByRole('button', { name: /Wiederherstellungsschlüssel verwenden/ }).click()
  await dialog.getByLabel('Wiederherstellungsschlüssel').fill(recoveryKey.replace(/-/g, '').toLowerCase())
  await dialog.getByLabel('Neues Tresor-Passwort').fill(PASSWORD)
  await dialog.getByLabel('Passwort wiederholen').fill(PASSWORD)
  await dialog.getByRole('button', { name: 'Entsperren', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 15_000 })
  await page.getByTestId('folder-tree').getByText(`Titel ${MARKER}`).click()
  await expect(page.locator('.cm-content')).toContainText(`Inhalt ${MARKER}`)
  const after = await page.evaluate((id) => fetch(`/api/notes/${id}`).then((r) => r.json()), noteId)
  expect(after.note.version).toBe(version.note.version)
  expect(after.note.content).toBe(version.note.content)

  // Danach gilt das neue Passwort aus dem Wiederherstellen
  await page.reload()
  await unlock(page, PASSWORD)
})

test('Veränderte Notiz wird erkannt, nicht angezeigt und nicht überschrieben', async ({ browser }) => {
  // Ohne Service Worker – sonst beantwortet er die Anfrage an page.route vorbei
  const context = await browser.newContext({ serviceWorkers: 'block' })
  const page = await context.newPage()
  page.on('pageerror', (err) => consoleErrors.push(String(err)))
  await login(page)
  const original = await page.evaluate((id) => fetch(`/api/notes/${id}`).then((r) => r.json()), noteId)
  await page.route(`**/api/notes/${noteId}`, async (route) => {
    const res = await route.fetch()
    const body = await res.json()
    // Ein Zeichen im Chiffretext ändern
    const c: string = body.note.content
    const i = c.length - 5
    body.note.content = c.slice(0, i) + (c[i] === 'A' ? 'B' : 'A') + c.slice(i + 1)
    await route.fulfill({ response: res, json: body })
  })
  await page.goto(`/?n=${noteId}`)
  await unlock(page)
  await expect(page.getByTestId('vault-note-corrupt')).toContainText(
    'Diese Notiz ist beschädigt oder wurde verändert und wird nicht angezeigt.',
  )
  await expect(page.locator('.cm-content')).toHaveCount(0)
  await page.unroute(`**/api/notes/${noteId}`)
  const after = await page.evaluate((id) => fetch(`/api/notes/${id}`).then((r) => r.json()), noteId)
  expect(after.note.version).toBe(original.note.version)
  await context.close()
})

test('Offline entsperren und bearbeiten – im localStorage nur Umschläge', async ({ page, context }) => {
  await login(page)
  await page.goto(`/?n=${noteId}`)
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)
  // Einmal online laden, damit Notiz, Liste und Schlüsselmaterial im Cache liegen
  await unlock(page)
  await expect(page.locator('.cm-content')).toContainText(`Inhalt ${MARKER}`)
  await page.reload()

  await context.setOffline(true)
  await page.reload()
  await unlock(page)
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText(`\nOffline ${MARKER}`)
  await expect(page.getByTestId('save-status')).toContainText('Offline', { timeout: 10_000 })
  const drafts = await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith('noted:drafts:'))
      .map((k) => localStorage.getItem(k))
      .join(''),
  )
  expect(drafts).toContain('nv1.')
  expect(drafts).not.toContain(MARKER)

  await context.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.getByTestId('save-status')).toContainText('Gespeichert', { timeout: 30_000 })
  await page.reload()
  await unlock(page)
  await expect(page.locator('.cm-content')).toContainText(`Offline ${MARKER}`)
})

test('Automatisch sperren nach Inaktivität; Sperren gilt für alle Tabs, Entsperren nur für einen', async ({
  page,
  context,
}) => {
  await page.clock.install()
  await login(page)
  await page.goto(`/?n=${noteId}`)
  await unlock(page)
  await expect(page.locator('.cm-content')).toContainText(`Inhalt ${MARKER}`)

  // Zweiter Tab: bleibt gesperrt, bis er selbst entsperrt wird
  const other = await context.newPage()
  await other.goto(`/?n=${noteId}`)
  await expect(other.getByTestId('vault-note-locked')).toBeVisible()
  await unlock(other)
  await expect(other.locator('.cm-content')).toContainText(`Inhalt ${MARKER}`)
  // Sperren im zweiten Tab sperrt auch den ersten
  await other.getByRole('button', { name: 'Tresor sperren' }).click()
  await expect(page.getByTestId('vault-note-locked')).toBeVisible()
  await other.close()

  // Nach 15 Minuten ohne Eingabe (Standard) sperrt der Tab von selbst
  await unlock(page)
  await expect(page.locator('.cm-content')).toBeVisible()
  await page.clock.fastForward('14:00')
  await expect(page.locator('.cm-content')).toBeVisible()
  await page.clock.fastForward('01:30')
  await expect(page.getByTestId('vault-note-locked')).toBeVisible()
})

test('Notiz in den Tresor verschieben und zurück; Formatwechsel und Verlauf im Tresor', async ({ page }) => {
  await login(page)
  const headers = await apiHeaders(page)
  const res = await page.request.post('/api/notes', {
    headers,
    data: { title: `Bewerbung ${MARKER}`, content: `# Anschreiben\n\nGeheim ${MARKER} #bewerbung` },
  })
  const id = (await res.json()).note.id as string
  await page.goto(`/?n=${id}`)
  await expect(page.locator('.cm-content')).toContainText(`Geheim ${MARKER}`)

  // Gesperrt fragt der Dialog zuerst nach dem Passwort
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click()
  await page.getByRole('menuitem', { name: 'In den Tresor verschieben …' }).click()
  const unlockDialog = page.getByRole('dialog', { name: 'Tresor entsperren' })
  await unlockDialog.getByLabel('Tresor-Passwort').fill(PASSWORD)
  await unlockDialog.getByRole('button', { name: 'Entsperren', exact: true }).click()
  const moveIn = page.getByRole('dialog', { name: 'In den Tresor verschieben' })
  await expect(moveIn).toContainText('Sicherungen des Servers')
  await shot(page, '63-vault-move-in')
  await moveIn.getByRole('button', { name: 'Verschieben' }).click()
  await expect(page.getByText('In den Tresor verschoben.')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Im Tresor')).toBeVisible()
  await expect(page.locator('.cm-content')).toContainText(`Geheim ${MARKER}`)

  const inside = await page.evaluate(async (noteId) => {
    const note = await fetch(`/api/notes/${noteId}`).then((r) => r.json())
    const search = await fetch('/api/search?q=quokkageheimnis').then((r) => r.json())
    const tags = await fetch('/api/tags').then((r) => r.text())
    return { note: note.note, results: search.results.length, tags }
  }, id)
  expect(inside.note.content).toMatch(/^nv1\./)
  expect(JSON.stringify(inside.note)).not.toContain(MARKER)
  expect(inside.results).toBe(0)
  expect(inside.tags).not.toContain('bewerbung')

  // Formatwechsel im Browser, gesichert wird verschlüsselt – der Verlauf entschlüsselt ihn wieder
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click()
  await page.getByRole('menuitem', { name: /Format/ }).click()
  const formatDialog = page.getByRole('dialog')
  await formatDialog.getByRole('radio', { name: /^Einfacher Text/ }).click()
  await formatDialog.getByRole('button', { name: 'Umwandeln' }).click()
  await expect(page.getByTestId('save-status')).toContainText('Gespeichert', { timeout: 10_000 })
  await expect
    .poll(async () => (await (await page.request.get(`/api/notes/${id}`)).json()).note.format)
    .toBe('text')
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click()
  await page.getByRole('menuitem', { name: 'Verlauf …' }).click()
  await expect(page.getByTestId('history-list')).toContainText('Vor dem Formatwechsel')
  await expect(page.getByTestId('history-preview')).toContainText(`Geheim ${MARKER}`)
  await page.keyboard.press('Escape')

  // Wieder heraus: danach unverschlüsselt und durchsuchbar
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click()
  await page.getByRole('menuitem', { name: 'Aus dem Tresor verschieben …' }).click()
  const moveOut = page.getByRole('dialog', { name: 'Aus dem Tresor verschieben' })
  await expect(moveOut).toContainText('Die Notiz ist danach unverschlüsselt und durchsuchbar.')
  await moveOut.getByRole('button', { name: 'Verschieben' }).click()
  await expect(page.getByText('Aus dem Tresor verschoben.')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Im Tresor')).toHaveCount(0)
  const outside = await page.evaluate(async (noteId) => {
    const note = await fetch(`/api/notes/${noteId}`).then((r) => r.json())
    const search = await fetch('/api/search?q=quokkageheimnis').then((r) => r.json())
    return { note: note.note, results: search.results.length }
  }, id)
  expect(outside.note).toMatchObject({ vault: false, title: `Bewerbung ${MARKER}` })
  expect(outside.note.content).toContain(`Geheim ${MARKER}`)
  expect(outside.results).toBe(1)

  await page.request.post('/api/notes/batch', { headers, data: { action: 'trash', ids: [id] } })
  await page.request.post('/api/notes/batch', { headers, data: { action: 'delete', ids: [id] } })
})

test('Tresor löschen', async ({ page }) => {
  await login(page)
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Tresor löschen …' }).click()
  const dialog = page.getByRole('dialog', { name: 'Tresor löschen?' })
  await dialog.getByRole('button', { name: 'Endgültig löschen' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Tippe „Tresor löschen“ ein')
  await dialog.getByLabel(/eintippen/).fill('Tresor löschen')
  await dialog.getByRole('button', { name: 'Endgültig löschen' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'Tresor einrichten' })).toBeVisible()
  const res = await page.evaluate((id) => fetch(`/api/notes/${id}`).then((r) => r.status), noteId)
  expect(res).toBe(404)
})
