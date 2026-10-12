import { expect, test } from '@playwright/test'

// Offline-Betrieb: Änderungen ohne Netz werden lokal gesichert, die App startet offline
// aus dem Cache des Service Workers und synchronisiert automatisch, sobald wieder Netz da ist.

const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'E2E-Admin-Passwort-1'
const SHOTS = process.env.SCREENSHOT_DIR

test('Offline weiterschreiben und automatisch synchronisieren', async ({ page, context }) => {
  await page.goto('/login')
  await page.getByLabel('Benutzername').fill('admin')
  await page.getByLabel('Passwort', { exact: true }).fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Administrator')

  // Notiz anlegen
  await page.getByRole('button', { name: 'Leere Notiz' }).click()
  await page.getByRole('dialog').getByLabel(/Titel/).fill('Bahnfahrt')
  await page.getByRole('dialog').getByRole('button', { name: 'Erstellen' }).click()
  await page.locator('.cm-content').click()
  await page.keyboard.insertText('Online geschrieben.')
  await expect(page.getByTestId('save-status')).toContainText('Gespeichert', { timeout: 10_000 })
  const url = page.url()
  const id = new URL(url).searchParams.get('n')!

  // Service Worker aktiv → einmal neu laden, damit App und Daten im Cache landen
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
  await page.reload()
  await expect(page.locator('.cm-content')).toContainText('Online geschrieben.')
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)
  await page.reload()
  await expect(page.locator('.cm-content')).toContainText('Online geschrieben.')

  // Netz weg (z. B. Tunnel)
  await context.setOffline(true)
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('\nOffline ergänzt.')
  await expect(page.getByTestId('save-status')).toContainText('Offline', { timeout: 10_000 })
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/16-offline.png` })

  // App offline neu starten: kommt aus dem Cache, Entwurf ist noch da
  await page.reload()
  await expect(page.locator('.cm-content')).toContainText('Offline ergänzt.')
  await expect(page.getByText(/Offline/).first()).toBeVisible()

  // Netz wieder da → automatische Synchronisierung
  await context.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.getByTestId('save-status')).toContainText('Gespeichert', { timeout: 30_000 })

  const server = await page.evaluate(async (noteId) => {
    const r = await fetch(`/api/notes/${noteId}`)
    return (await r.json()).note.content as string
  }, id)
  expect(server).toBe('Online geschrieben.\nOffline ergänzt.')
})

test('Konflikt zwischen zwei Geräten wird erkannt', async ({ browser }) => {
  const login = async () => {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto('/login')
    await page.getByLabel('Benutzername').fill('admin')
    await page.getByLabel('Passwort', { exact: true }).fill(ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Anmelden' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Administrator')
    return { context, page }
  }
  const a = await login()
  const id = await a.page.evaluate(async () => {
    const r = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-noted-request': '1' },
      body: JSON.stringify({ title: 'Geteilt', content: 'Version 1' }),
    })
    const body = await r.json()
    if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(body)}`)
    return body.note.id as string
  })
  const b = await login()
  await a.page.goto(`/?n=${id}`)
  await b.page.goto(`/?n=${id}`)
  await expect(a.page.locator('.cm-content')).toContainText('Version 1')
  await expect(b.page.locator('.cm-content')).toContainText('Version 1')

  // Gerät A speichert zuerst
  await a.page.locator('.cm-content').click()
  await a.page.keyboard.press('Control+End')
  await a.page.keyboard.insertText(' – Laptop')
  await expect(a.page.getByTestId('save-status')).toContainText('Gespeichert', { timeout: 10_000 })

  // Gerät B arbeitet noch mit der alten Version → Konflikt
  await b.page.locator('.cm-content').click()
  await b.page.keyboard.press('Control+End')
  await b.page.keyboard.insertText(' – Handy')
  await expect(b.page.getByText('Konflikt:')).toBeVisible({ timeout: 10_000 })
  if (SHOTS) await b.page.screenshot({ path: `${SHOTS}/17-conflict.png` })
  await b.page.getByRole('button', { name: 'Beide behalten' }).click()
  await expect(b.page.locator('.cm-content')).toContainText('Version 1 – Laptop')

  // Die Handy-Version liegt jetzt als Kopie vor
  const titles = await b.page.evaluate(async () => {
    const r = await fetch('/api/notes')
    return ((await r.json()).notes as { title: string }[]).map((n) => n.title)
  })
  expect(titles.some((t) => t.startsWith('Geteilt (Konflikt'))).toBe(true)
  await a.context.close()
  await b.context.close()
})
