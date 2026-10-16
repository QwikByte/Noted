import { expect, test, type Page } from '@playwright/test'

// Globale Werkzeugleiste mit dem Fokus-Timer. Die Uhr im Browser ist vorgespult (page.clock), statt 25 Minuten zu warten.

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

test('Werkzeugleiste: ausklappen, verschieben, Fokus-Timer über Neuladen hinweg bis zur Pause', async ({ page }) => {
  await page.clock.install()
  await login(page)
  const bar = page.getByTestId('global-toolbar')

  // Eingeklappt nur ein Knopf; ausgeklappt die Werkzeuge
  await bar.getByRole('button', { name: 'Werkzeuge' }).click()
  await expect(page.getByRole('toolbar', { name: 'Werkzeuge' })).toBeVisible()

  // Verschieben mit der Maus und mit den Pfeiltasten; die Position bleibt nach dem Neuladen
  const grip = bar.getByRole('button', { name: 'Werkzeugleiste verschieben' })
  const before = (await bar.boundingBox())!
  const g = (await grip.boundingBox())!
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2)
  await page.mouse.down()
  await page.mouse.move(g.x - 300, g.y - 200, { steps: 6 })
  await page.mouse.up()
  const dragged = (await bar.boundingBox())!
  expect(dragged.x).toBeLessThan(before.x - 250)
  expect(dragged.y).toBeLessThan(before.y - 150)
  await grip.press('ArrowRight')
  await expect.poll(async () => (await bar.boundingBox())!.x).toBeGreaterThan(dragged.x)

  // Fokus-Timer als Fenster öffnen und starten
  await bar.getByRole('button', { name: 'Fokus-Timer' }).click()
  const win = page.getByTestId('window-focus')
  await expect(win.getByTestId('focus-phase')).toHaveText('Fokus · Runde 1 von 4')
  await expect(win.getByTestId('focus-clock')).toHaveText('25:00')
  await win.getByRole('button', { name: 'Start' }).click()
  await expect(win.getByRole('button', { name: 'Anhalten' })).toBeVisible()
  // Während der Timer läuft, lässt sich die Art nicht versehentlich wechseln
  await expect(win.getByRole('radio', { name: 'Countdown' })).toBeDisabled()
  await page.clock.fastForward('05:00')
  await expect(win.getByTestId('focus-clock')).toHaveText('20:00')
  await shot(page, '50-focus-timer')

  // Neuladen: Leiste (an derselben Stelle), Fenster und laufender Timer sind noch da
  const placed = (await bar.boundingBox())!
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Administrator')
  await expect(bar.getByTestId('focus-badge')).toBeVisible()
  expect(Math.round((await bar.boundingBox())!.x)).toBe(Math.round(placed.x))
  expect(Math.round((await bar.boundingBox())!.y)).toBe(Math.round(placed.y))
  await expect(win.getByTestId('focus-clock')).toHaveText(/^(20:00|19:5\d)$/)

  // Ende der Fokus-Runde: Meldung, und die kurze Pause läuft gleich weiter
  await page.clock.fastForward('20:00')
  await expect(page.getByText('Fokus-Runde geschafft – Zeit für eine kurze Pause (5 min).')).toBeVisible()
  await expect(win.getByTestId('focus-phase')).toHaveText('Kurze Pause · Runde 1 von 4')
  await expect(win.getByRole('button', { name: 'Anhalten' })).toBeVisible()

  // Fenster zu, Leiste ein: Die Restzeit bleibt sichtbar
  await win.getByRole('button', { name: 'Schließen' }).click()
  await expect(win).toHaveCount(0)
  await bar.getByRole('button', { name: 'Werkzeugleiste einklappen' }).click()
  await expect(bar.getByRole('button', { name: 'Werkzeuge' }).getByTestId('focus-badge')).toHaveText(/^0[45]:\d\d$/)
  await shot(page, '51-toolbar-collapsed')
})

test('Fokus-Timer: Countdown mit eigener Dauer und Systembenachrichtigung', async ({ page }) => {
  // Headless-Chromium lehnt Benachrichtigungen immer ab – daher eine Attrappe, die mitschreibt
  type Recorded = { __notes?: { title: string; body?: string }[] }
  await page.addInitScript(() => {
    const notes: { title: string; body?: string }[] = []
    const w = window as Recorded
    w.__notes = notes
    class FakeNotification {
      static permission: NotificationPermission = 'default'
      static requestPermission = async () => (FakeNotification.permission = 'granted')
      onclick: (() => void) | null = null
      constructor(title: string, options?: NotificationOptions) {
        notes.push({ title, body: options?.body })
      }
      close() {}
    }
    Object.defineProperty(window, 'Notification', { value: FakeNotification })
    // Wie ein Tab im Hintergrund – nur dann kommt die Systembenachrichtigung
    document.hasFocus = () => false
  })
  await page.clock.install()
  await login(page)
  const bar = page.getByTestId('global-toolbar')
  await bar.getByRole('button', { name: 'Werkzeuge' }).click()
  await bar.getByRole('button', { name: 'Fokus-Timer' }).click()
  const win = page.getByTestId('window-focus')

  await win.getByRole('radio', { name: 'Countdown' }).click()
  await win.getByRole('button', { name: '5 min', exact: true }).click()
  await expect(win.getByTestId('focus-clock')).toHaveText('05:00')

  // Einschalten fragt nach der Erlaubnis
  await win.getByRole('button', { name: 'Einstellungen' }).click()
  const notify = win.getByRole('switch', { name: 'Systembenachrichtigung' })
  await notify.click()
  await expect(notify).toHaveAttribute('aria-checked', 'true')

  // Eigene Dauer gilt erst nach dem Verlassen des Felds
  const minutes = win.getByLabel('Eigene Dauer (min)')
  await minutes.fill('3')
  await expect(win.getByTestId('focus-clock')).toHaveText('05:00')
  await minutes.press('Enter')
  await expect(win.getByTestId('focus-clock')).toHaveText('03:00')

  await win.getByRole('button', { name: 'Start' }).click()
  await page.clock.fastForward('03:00')
  await expect(page.getByText('Zeit ist um – Der Countdown (3 min) ist abgelaufen.')).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => (window as Recorded).__notes))
    .toEqual([{ title: 'Zeit ist um', body: 'Der Countdown (3 min) ist abgelaufen.' }])
  // Danach steht der Countdown wieder am Anfang
  await expect(win.getByTestId('focus-clock')).toHaveText('03:00')
  await expect(win.getByRole('button', { name: 'Start' })).toBeVisible()
  await expect(bar.getByTestId('focus-badge')).toHaveCount(0)
})
