import { expect, test, type Locator, type Page } from '@playwright/test'
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

/** Abstand eines Elements zum rechten bzw. linken und zum unteren Rand */
async function gaps(page: Page, locator: Locator) {
  const b = (await locator.boundingBox())!
  const { width, height } = page.viewportSize()!
  return { left: Math.round(b.x), right: Math.round(width - b.x - b.width), bottom: Math.round(height - b.y - b.height) }
}

test('Werkzeugleiste fest unten rechts, Fokus-Timer über Neuladen hinweg bis zur Pause', async ({ page }) => {
  await page.clock.install()
  await login(page)
  const bar = page.getByTestId('global-toolbar')

  // Eingeklappt ein Knopf in der Ecke unten rechts; ausgeklappt bleibt die Leiste dort, ohne Griff zum Verschieben
  expect(await gaps(page, bar)).toMatchObject({ right: 8, bottom: 8 })
  await bar.getByRole('button', { name: 'Werkzeuge' }).click()
  await expect(page.getByRole('toolbar', { name: 'Werkzeuge' })).toBeVisible()
  expect(await gaps(page, bar)).toMatchObject({ right: 8, bottom: 8 })
  await expect(bar.getByRole('button', { name: /verschieben/ })).toHaveCount(0)

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

  // Neuladen: Leiste, Fenster und laufender Timer sind noch da
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Administrator')
  await expect(win.getByTestId('focus-clock')).toHaveText(/^(20:00|19:5\d)$/)
  await expect(page.getByRole('toolbar', { name: 'Werkzeuge' })).toBeVisible()

  // Ende der Fokus-Runde: Meldung, und die kurze Pause läuft gleich weiter
  await page.clock.fastForward('20:00')
  await expect(page.getByText('Fokus-Runde geschafft – Zeit für eine kurze Pause (5 min).')).toBeVisible()
  await expect(win.getByTestId('focus-phase')).toHaveText('Kurze Pause · Runde 1 von 4')
  await expect(win.getByRole('button', { name: 'Anhalten' })).toBeVisible()

  // Fenster zu: Der laufende Timer steht klein unten links, direkt neben der Seitenleiste
  const mini = page.getByTestId('focus-mini')
  await expect(mini).toHaveCount(0)
  await win.getByRole('button', { name: 'Schließen' }).click()
  await expect(win).toHaveCount(0)
  await expect(mini).toContainText(/Kurze Pause\s*0[45]:\d\d/)
  const sidebar = (await page.locator('aside').first().boundingBox())!
  // Nach der Einblend-Animation messen
  await expect.poll(() => gaps(page, mini)).toMatchObject({ left: Math.round(sidebar.x + sidebar.width + 8), bottom: 8 })
  await shot(page, '51-focus-mini')

  // Ein Klick darauf öffnet wieder das Fenster
  await mini.click()
  await expect(win).toBeVisible()
  await expect(mini).toHaveCount(0)
  // Angehalten bleibt er bei geschlossenem Fenster weg
  await win.getByRole('button', { name: 'Anhalten' }).click()
  await win.getByRole('button', { name: 'Schließen' }).click()
  await expect(mini).toHaveCount(0)

  // Das Kreuz klappt die Leiste wieder ein
  await bar.getByRole('button', { name: 'Werkzeugleiste schließen' }).click()
  await expect(page.getByRole('toolbar', { name: 'Werkzeuge' })).toHaveCount(0)
  await expect(bar.getByRole('button', { name: 'Werkzeuge' })).toBeVisible()
})

async function startTimerAndClose(page: Page) {
  const bar = page.getByTestId('global-toolbar')
  await bar.getByRole('button', { name: 'Werkzeuge' }).click()
  await bar.getByRole('button', { name: 'Fokus-Timer' }).click()
  const win = page.getByTestId('window-focus')
  await win.getByRole('button', { name: 'Start' }).click()
  await win.getByRole('button', { name: 'Schließen' }).click()
  await expect(page.getByTestId('focus-mini')).toBeVisible()
}

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

  await startTimerAndClose(page)
  for (const el of [page.getByTestId('focus-mini'), page.getByTestId('global-toolbar')]) {
    await expect.poll(async () => (await gaps(page, el)).bottom).toBeGreaterThan(page.viewportSize()!.height - barTop + 8)
  }
  await shot(page, '52-focus-study')

  // Nach dem Lernen gilt wieder der ganze Bildschirm
  await reveal.click()
  await page.getByTestId('rate-4').click()
  await expect(reveal).toHaveCount(0)
  await expect.poll(async () => (await gaps(page, page.getByTestId('focus-mini'))).bottom).toBe(8)
})

test('Leiste über den Zoom-Knöpfen der Mindmap', async ({ page }) => {
  await login(page)
  const created = await page.request.post('/api/notes', {
    headers: await apiHeaders(page),
    data: { title: 'Gedanken', format: 'mindmap', content: '---\nmindmap-plugin: basic\n---\n\n# Gedanken\n\n## Idee\n' },
  })
  expect(created.status()).toBe(201)
  await page.goto(`/?n=${(await created.json()).note.id}`)
  const zoom = page.getByRole('button', { name: 'Alles anzeigen' })
  await expect(zoom).toBeVisible()
  const bar = (await page.getByTestId('global-toolbar').boundingBox())!
  expect(bar.y + bar.height).toBeLessThan((await zoom.boundingBox())!.y)
})

test('Auf dem Handy: Mini-Timer ganz unten links, Leiste über „Neue Notiz“', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await login(page)
  const bar = page.getByTestId('global-toolbar')
  const fab = page.getByRole('button', { name: 'Neue Notiz' })
  await expect(fab).toBeVisible()
  expect((await bar.boundingBox())!.y + (await bar.boundingBox())!.height).toBeLessThan((await fab.boundingBox())!.y)

  await startTimerAndClose(page)
  await expect.poll(() => gaps(page, page.getByTestId('focus-mini'))).toMatchObject({ left: 8, bottom: 8 })
  await shot(page, '53-focus-mobile')

  // Ohne „Neue Notiz“ (in einer Notiz) sitzt die Leiste wieder in der Ecke
  const created = await page.request.post('/api/notes', {
    headers: await apiHeaders(page),
    data: { title: 'Mitschrift', content: 'Text' },
  })
  await page.goto(`/?n=${(await created.json()).note.id}`)
  await expect(page.getByTestId('note-title')).toHaveValue('Mitschrift')
  await expect(fab).toHaveCount(0)
  await expect.poll(async () => await gaps(page, bar)).toMatchObject({ right: 8, bottom: 8 })
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
