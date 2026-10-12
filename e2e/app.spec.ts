import { expect, test, type Page } from '@playwright/test'
import { Secret, TOTP } from 'otpauth'

// Ende-zu-Ende-Durchlauf: Admin legt Benutzer an → erste Anmeldung mit Passwortwechsel und
// Pflicht-MFA → Notiz mit Vorlage schreiben, Vorschau prüfen, kopieren → erneute Anmeldung mit Code.

const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'E2E-Admin-Passwort-1'
const SHOTS = process.env.SCREENSHOT_DIR

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false })
}

// Jeder Code darf nur einmal verwendet werden (Replay-Schutz) – daher immer einen neuen Zeitschritt nehmen
let lastStep = 0
async function nextCode(secret: string) {
  let current = Math.floor(Date.now() / 30_000)
  let step = Math.max(current, lastStep + 1)
  while (step > current + 1) {
    await new Promise((r) => setTimeout(r, 1000))
    current = Math.floor(Date.now() / 30_000)
    step = Math.max(current, lastStep + 1)
  }
  lastStep = step
  return new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate({ timestamp: step * 30_000 + 1_000 })
}

async function login(page: Page, username: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Benutzername').fill(username)
  await page.getByLabel('Passwort', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Anmelden' }).click()
}

async function logout(page: Page) {
  await page.goto('/settings')
  await page.getByRole('main').getByRole('button', { name: 'Abmelden' }).click()
  await expect(page).toHaveURL(/\/login/)
}

test.describe.configure({ mode: 'serial' })

// Keine Fehler in der Browser-Konsole (z. B. CSP-Verstöße, React-Fehler)
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

let studentPassword = ''
let studentSecret = ''

test('Admin meldet sich an und legt einen Benutzer mit Pflicht-MFA an', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
  await shot(page, '01-login')

  await login(page, 'admin', 'falsches-passwort')
  await expect(page.getByText('Benutzername oder Passwort ist falsch.')).toBeVisible()

  await login(page, 'admin', ADMIN_PASSWORD)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Administrator')
  await shot(page, '02-home-empty')

  await page.goto('/admin')
  await page.getByRole('button', { name: 'Benutzer anlegen' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Benutzername').fill('lisa')
  await dialog.getByLabel('Anzeigename').fill('Lisa Müller')
  await dialog.getByRole('switch', { name: /Zwei-Faktor-Anmeldung vorschreiben/ }).click()
  await shot(page, '03-admin-create-user')
  await dialog.getByRole('button', { name: 'Anlegen' }).click()

  const pw = page.getByTestId('generated-password')
  await expect(pw).toBeVisible()
  studentPassword = (await pw.textContent())!.trim()
  expect(studentPassword).toMatch(/^\w{4}(-\w{4}){3}$/)
  await shot(page, '04-admin-credentials')
  await page.getByRole('button', { name: 'Fertig' }).click()

  const row = page.getByTestId('user-lisa')
  await expect(row).toContainText('MFA ausstehend')
  await expect(row).toContainText('Startpasswort')
  await shot(page, '05-admin-users')

  await page.getByRole('tab', { name: 'Protokoll' }).click()
  await expect(page.getByText('Benutzer angelegt').first()).toBeVisible()
  await expect(page.getByText('Fehlgeschlagene Anmeldung').first()).toBeVisible()
  await logout(page)
})

test('Erste Anmeldung: Passwort ändern und MFA einrichten', async ({ page }) => {
  await login(page, 'lisa', studentPassword)
  await expect(page).toHaveURL(/\/setup/)
  await expect(page.getByText('Schritt 1 von 2')).toBeVisible()
  await page.getByLabel('Aktuelles Passwort').fill(studentPassword)
  await page.getByLabel('Neues Passwort', { exact: true }).fill('Mein-sicheres-Passwort-1')
  await page.getByLabel('Neues Passwort wiederholen').fill('Mein-sicheres-Passwort-1')
  await shot(page, '06-setup-password')
  await page.getByRole('button', { name: 'Passwort festlegen' }).click()

  await expect(page.getByText('Schritt 2 von 2')).toBeVisible()
  await page.getByRole('button', { name: 'Einrichtung starten' }).click()
  await expect(page.getByAltText('QR-Code für die Authenticator-App')).toBeVisible()
  studentSecret = (await page.locator('code').first().textContent())!.replace(/\s/g, '')
  await shot(page, '07-setup-mfa')
  await page.getByLabel('Code').fill(await nextCode(studentSecret))
  await page.getByRole('button', { name: 'Aktivieren' }).click()

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Lisa')
})

test('Notiz mit Vorlage schreiben, Vorschau prüfen und als Markdown kopieren', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await login(page, 'lisa', 'Mein-sicheres-Passwort-1')
  await page.getByLabel('Code').fill(await nextCode(studentSecret))
  await page.getByRole('button', { name: 'Bestätigen' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Lisa')

  // Ordner anlegen
  await page.getByRole('button', { name: 'Neuer Ordner' }).click()
  await page.getByRole('dialog').getByLabel('Name').fill('Analysis I')
  await page.getByRole('dialog').getByRole('button', { name: 'Anlegen' }).click()
  await expect(page.getByRole('button', { name: /Analysis I/ })).toBeVisible()

  // Neue Vorlesungsnotiz
  await page.getByRole('button', { name: 'Vorlesung' }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel(/Titel/)).toHaveValue(/\d{4}-\d{2}-\d{2} Vorlesung/)
  await dialog.getByLabel(/Titel/).fill('Folgen und Grenzwerte')
  await dialog.getByLabel('Ordner').selectOption({ label: 'Analysis I' })
  await shot(page, '08-new-note-dialog')
  await dialog.getByRole('button', { name: 'Erstellen' }).click()

  await expect(page.getByTestId('note-title')).toHaveValue('Folgen und Grenzwerte')
  const editor = page.locator('.cm-content')
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText(
    [
      '',
      'Eine Folge $(a_n)$ konvergiert gegen $a$, wenn gilt:',
      '',
      '$$',
      '\\forall \\varepsilon > 0\\ \\exists N: |a_n - a| < \\varepsilon',
      '$$',
      '',
      '> [!warning] Achtung',
      '> Nicht jede ==beschränkte== Folge konvergiert.',
      '',
      'Siehe auch [[Cauchy-Folgen]] #analysis/folgen',
      '',
      '- [ ] Übungsblatt 3 rechnen',
      '- [x] Skript lesen',
      '',
      '```mermaid',
      'graph LR; A[beschränkt] --> B[monoton]; B --> C[konvergent]',
      '```',
    ].join('\n'),
  )
  await expect(page.getByTestId('save-status')).toContainText('Gespeichert', { timeout: 10_000 })
  await shot(page, '09-editor')

  // Lesemodus (Obsidian-Vorschau)
  await page.getByRole('radio', { name: 'Lesen' }).click()
  const preview = page.locator('.markdown-body')
  await expect(preview.locator('.callout-warning')).toContainText('Nicht jede')
  await expect(preview.locator('mark')).toHaveText('beschränkte')
  await expect(preview.locator('.katex').first()).toBeVisible()
  await expect(preview.locator('.katex-display')).toBeVisible()
  await expect(preview.locator('a.tag', { hasText: '#analysis/folgen' })).toBeVisible()
  await expect(preview.locator('a.wikilink.unresolved')).toHaveText('Cauchy-Folgen')
  await expect(preview.locator('.mermaid-block svg')).toBeVisible({ timeout: 15_000 })
  await expect(preview.locator('dl a.tag', { hasText: '#vorlesung' })).toBeVisible() // Properties
  await shot(page, '10-preview')

  // Aufgabe in der Vorschau abhaken
  await preview.locator('li', { hasText: 'Übungsblatt 3 rechnen' }).locator('.task-checkbox').check()
  await expect(page.getByTestId('save-status')).toContainText('Gespeichert', { timeout: 10_000 })

  // Kopieren → Zwischenablage enthält reines Obsidian-Markdown
  await page.getByRole('button', { name: 'Kopieren' }).click()
  await expect(page.getByText('Markdown kopiert')).toBeVisible()
  const clip = await page.evaluate(() => navigator.clipboard.readText())
  expect(clip).toMatch(/^---\ntags:\n {2}- vorlesung\n/)
  expect(clip).toContain('> [!warning] Achtung')
  expect(clip).toContain('- [x] Übungsblatt 3 rechnen')
  expect(clip).toContain('[[Cauchy-Folgen]]')

  // Unaufgelösten Wikilink anklicken → neue Notiz
  await preview.locator('a.wikilink.unresolved').click()
  await expect(page.getByTestId('note-title')).toHaveValue('Cauchy-Folgen')
  await page.locator('.cm-content').click()
  await page.keyboard.insertText('Verweis zurück: ')
  await page.keyboard.type('[[Folg')
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('Folgen und Grenzwerte')
  await page.waitForTimeout(200) // CodeMirror ignoriert Enter direkt nach dem Öffnen der Vorschläge
  await page.keyboard.press('Enter')
  await expect(page.locator('.cm-content')).toContainText('[[Folgen und Grenzwerte]]')
  await expect(page.getByTestId('save-status')).toContainText('Gespeichert', { timeout: 10_000 })

  // Suche
  await page.goto('/?q=konvergiert')
  await expect(page.locator('mark', { hasText: 'konvergiert' }).first()).toBeVisible()
  await shot(page, '11-search')

  // Backlinks
  await page.getByRole('button', { name: /Folgen und Grenzwerte/ }).first().click()
  await page.getByRole('radio', { name: 'Lesen' }).click()
  await expect(page.getByText('Verlinkt in 1 Notiz')).toBeVisible()
})

test('Mobile Ansicht', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'de-DE',
  })
  const page = await context.newPage()
  await login(page, 'lisa', 'Mein-sicheres-Passwort-1')
  await page.getByLabel('Code').fill(await nextCode(studentSecret))
  await page.getByRole('button', { name: 'Bestätigen' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Lisa')
  await shot(page, '12-mobile-home')
  await page.getByRole('button', { name: 'Menü öffnen' }).click()
  await shot(page, '13-mobile-drawer')
  const drawer = page.getByRole('complementary')
  await drawer.getByRole('button', { name: /^Analysis I/ }).click()
  await drawer.getByRole('button', { name: 'Folgen und Grenzwerte' }).click()
  await expect(page.getByTestId('note-title')).toBeVisible()
  await shot(page, '14-mobile-editor')
  await page.getByRole('radio', { name: 'Lesen' }).click()
  await shot(page, '15-mobile-preview')
  await context.close()
})
