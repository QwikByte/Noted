import { expect, test, type Page } from '@playwright/test'

// Updates: Die App erkennt eine neue Server-Version und bietet „Neu laden“ an; der Admin sieht unter
// Administration → System die laufende Version und den Status des Update-Skripts.

const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'E2E-Admin-Passwort-1'
const SHOTS = process.env.SCREENSHOT_DIR

async function loginAdmin(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Benutzername').fill('admin')
  await page.getByLabel('Passwort', { exact: true }).fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Administrator')
}

test('Build-ID steckt in Seite, Service Worker und Versions-API', async ({ page }) => {
  await loginAdmin(page)
  // Next.js hängt die Build-ID (deploymentId) als ?dpl=… an seine Dateien an
  const dpl = await page.evaluate(() => {
    const src = document.querySelector<HTMLScriptElement>('script[src*="dpl="]')?.src
    return src ? new URL(src).searchParams.get('dpl') : null
  })
  expect(dpl).toMatch(/^dev-[0-9a-f]{10}$/)
  const [api, sw] = await page.evaluate(async () => [
    await fetch('/api/version').then((r) => r.json()),
    await fetch('/sw.js').then((r) => r.text()),
  ])
  expect(api.buildId).toBe(dpl)
  expect(sw).toContain(`const VERSION = ${JSON.stringify(dpl)}`)
})

test('Neue Version wird erkannt und per „Neu laden“ übernommen', async ({ page }) => {
  type Marked = { __vorher?: boolean }
  const newVersion = { buildId: 'neuer-build', version: 'v9.9.9' }
  await loginAdmin(page)
  // Server meldet eine andere Version (wie nach einem Update)
  await page.route('**/api/version', (route) => route.fulfill({ json: newVersion }))
  await page.reload()
  const banner = page.getByTestId('update-banner')
  await expect(banner).toContainText('Neue Version verfügbar (v9.9.9)', { timeout: 15_000 })
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/20-update-banner.png` })

  // „Später“ blendet den Hinweis aus
  await banner.getByRole('button', { name: 'Später erinnern' }).click()
  await expect(banner).toBeHidden()

  // Erneut geöffnet → Hinweis wieder da → „Neu laden“ lädt die Seite neu
  await page.reload()
  await expect(banner).toBeVisible({ timeout: 15_000 })
  await page.unroute('**/api/version')
  await page.evaluate(() => ((window as Marked).__vorher = true))
  await banner.getByRole('button', { name: 'Neu laden' }).click()
  await page.waitForFunction(() => !(window as Marked).__vorher, null, { timeout: 15_000 })
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Administrator')

  // Jetzt passt die Version zum Server → kein Hinweis mehr (erste Prüfung nach 5 s)
  await page.waitForTimeout(7_000)
  await expect(banner).toBeHidden()
})

test('Administration → System zeigt Version und Update-Status', async ({ page }) => {
  await loginAdmin(page)
  await page.goto('/admin')
  await page.getByRole('tab', { name: 'System' }).click()
  await expect(page.getByTestId('app-version')).toBeVisible()
  const status = page.getByTestId('update-status')
  await expect(status).toContainText('In Ordnung')
  await expect(status).toContainText('Aktuell (v1.2.0)')
  await status.getByText('Protokoll des letzten Update-Laufs').click()
  await expect(status).toContainText('Fertig: v1.2.0 läuft.')

  // Update sofort anstoßen – die App legt nur eine Anfrage für den Update-Dienst auf dem Server ab
  await status.getByRole('button', { name: 'Jetzt nach Updates suchen' }).click()
  await expect(page.getByTestId('update-request')).toContainText('Prüfung angefordert gerade eben von @admin')
  await expect(status.getByRole('button', { name: 'Jetzt nach Updates suchen' })).toBeDisabled()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/21-admin-system.png`, fullPage: true })

  // Im Protokoll nachvollziehbar
  await page.getByRole('tab', { name: 'Protokoll' }).click()
  await expect(page.getByText('Update angefordert').first()).toBeVisible()
})
