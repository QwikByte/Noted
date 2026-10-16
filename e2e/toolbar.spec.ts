import { expect, test, type Page } from '@playwright/test'
import { apiHeaders } from './helpers'

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

test('Werkzeugleiste: ausklappen, einrasten, Fokus-Timer über Neuladen hinweg bis zur Pause', async ({ page }) => {
  await page.clock.install()
  await login(page)
  const bar = page.getByTestId('global-toolbar')
  const { height: vh } = page.viewportSize()!

  // Eingeklappt nur ein Knopf oben; ausgeklappt die Werkzeuge
  await bar.getByRole('button', { name: 'Werkzeuge' }).click()
  await expect(page.getByRole('toolbar', { name: 'Werkzeuge' })).toBeVisible()
  const top = (await bar.boundingBox())!
  expect(top.y).toBeLessThan(20)

  // Ziehen: seitlich frei, beim Loslassen rastet die Leiste am näheren Rand ein (hier unten)
  const grip = bar.getByRole('button', { name: 'Werkzeugleiste verschieben' })
  const g = (await grip.boundingBox())!
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2)
  await page.mouse.down()
  await page.mouse.move(g.x - 300, vh * 0.7, { steps: 6 })
  await page.mouse.up()
  const bottomEdge = async () => {
    const b = (await bar.boundingBox())!
    return vh - (b.y + b.height)
  }
  await expect.poll(bottomEdge).toBeLessThan(20)
  expect((await bar.boundingBox())!.x).toBeLessThan(top.x - 250)
  // Pfeiltasten: ↑ springt nach oben, ←/→ verschieben seitlich
  await grip.press('ArrowUp')
  await expect.poll(async () => (await bar.boundingBox())!.y).toBeLessThan(20)
  const left = (await bar.boundingBox())!.x
  await grip.press('ArrowRight')
  await expect.poll(async () => (await bar.boundingBox())!.x).toBeGreaterThan(left)

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
  // Die Restzeit steht nur im Fenster, nicht zusätzlich an der Leiste
  await expect(bar).not.toContainText(/\d:\d\d/)

  // Einstellungen über das Symbol im Fensterkopf
  const settingsToggle = win.getByRole('button', { name: 'Einstellungen' })
  await expect(win.getByLabel('Fokus (min)')).toHaveCount(0)
  await settingsToggle.click()
  await expect(settingsToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(win.getByLabel('Fokus (min)')).toHaveValue('25')
  await shot(page, '50-focus-timer')
  await settingsToggle.click()
  await expect(win.getByLabel('Fokus (min)')).toHaveCount(0)

  // Neuladen: Leiste (an derselben Stelle), Fenster und laufender Timer sind noch da
  const placed = (await bar.boundingBox())!
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Administrator')
  await expect(win.getByTestId('focus-clock')).toHaveText(/^(20:00|19:5\d)$/)
  expect(Math.round((await bar.boundingBox())!.x)).toBe(Math.round(placed.x))
  expect(Math.round((await bar.boundingBox())!.y)).toBe(Math.round(placed.y))

  // Ende der Fokus-Runde: Meldung, und die kurze Pause läuft gleich weiter
  await page.clock.fastForward('20:00')
  await expect(page.getByText('Fokus-Runde geschafft – Zeit für eine kurze Pause (5 min).')).toBeVisible()
  await expect(win.getByTestId('focus-phase')).toHaveText('Kurze Pause · Runde 1 von 4')
  await expect(win.getByRole('button', { name: 'Anhalten' })).toBeVisible()

  // Fenster zu: Der laufende Timer bleibt klein unten mittig sichtbar
  const mini = page.getByTestId('focus-mini')
  await expect(mini).toHaveCount(0)
  await win.getByRole('button', { name: 'Schließen' }).click()
  await expect(win).toHaveCount(0)
  await expect(mini).toContainText(/Kurze Pause\s*0[45]:\d\d/)
  const m = (await mini.boundingBox())!
  expect(Math.abs(m.x + m.width / 2 - page.viewportSize()!.width / 2)).toBeLessThan(2)
  expect(vh - (m.y + m.height)).toBeLessThan(20)
  await shot(page, '51-focus-mini')

  // Ein Klick darauf öffnet wieder das Fenster
  await mini.click()
  await expect(win).toBeVisible()
  await expect(mini).toHaveCount(0)
  // Angehalten bleibt er bei geschlossenem Fenster weg
  await win.getByRole('button', { name: 'Anhalten' }).click()
  await win.getByRole('button', { name: 'Schließen' }).click()
  await expect(mini).toHaveCount(0)
})

test('Beim Lernen bleiben Leiste und Mini-Timer über den Bewertungsknöpfen', async ({ page }) => {
  await login(page)
  const headers = await apiHeaders(page)
  const deck = (await (await page.request.post('/api/decks', { headers, data: { name: 'Fokus' } })).json()).deck
  const cards = await page.request.post(`/api/decks/${deck.id}/cards`, {
    headers,
    data: { cards: [{ type: 'basic', front: 'Frage', back: 'Antwort' }] },
  })
  expect(cards.status()).toBe(201)
  await page.goto(`/?d=${deck.id}`)
  await page.getByTestId('deck-learn').click()
  const reveal = page.getByTestId('reveal')
  await expect(reveal).toBeVisible()
  const barTop = (await reveal.boundingBox())!.y

  // Timer starten, Fenster schließen: Der Mini-Timer sitzt über der Leiste mit den Knöpfen
  const bar = page.getByTestId('global-toolbar')
  await bar.getByRole('button', { name: 'Werkzeuge' }).click()
  await bar.getByRole('button', { name: 'Fokus-Timer' }).click()
  const win = page.getByTestId('window-focus')
  await win.getByRole('button', { name: 'Start' }).click()
  await win.getByRole('button', { name: 'Schließen' }).click()
  const m = (await page.getByTestId('focus-mini').boundingBox())!
  expect(m.y + m.height).toBeLessThan(barTop - 8)

  // Auch die unten eingerastete Werkzeugleiste
  await bar.getByRole('button', { name: 'Werkzeugleiste verschieben' }).press('ArrowDown')
  await expect.poll(async () => (await bar.boundingBox())!.y).toBeGreaterThan(page.viewportSize()!.height / 2)
  const b = (await bar.boundingBox())!
  expect(b.y + b.height).toBeLessThan(barTop - 8)
  await shot(page, '52-focus-study')

  // Nach dem Lernen gilt wieder der ganze Bildschirm
  await page.getByTestId('reveal').click()
  await page.getByTestId('rate-4').click()
  await expect(page.getByTestId('reveal')).toHaveCount(0)
  await expect.poll(async () => {
    const box = (await page.getByTestId('focus-mini').boundingBox())!
    return page.viewportSize()!.height - (box.y + box.height)
  }).toBeLessThan(20)
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
