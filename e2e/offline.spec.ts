import { expect, test } from '@playwright/test'
import { apiHeaders, makePdf } from './helpers'

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

  // Direkt nach dem Tippen den Tab schließen: Beim Tippen wird der lokale Speicher gebündelt geschrieben, beim
  // Verlassen der Seite (pagehide) aber sofort – ein zweiter Tab findet den Entwurf. Das Ereignis von Hand: Ein echtes
  // Schließen oder Neuladen ließe den letzten Sendeversuch trotz „offline“ zum Server durch
  await context.setOffline(true)
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('\nKurz vor dem Aussteigen.')
  const stored = await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide'))
    return Object.entries(localStorage).find(([key]) => key.startsWith('noted:drafts:'))?.[1] ?? ''
  })
  expect(stored).toContain('Kurz vor dem Aussteigen.')
  const next = await context.newPage()
  await next.goto(url)
  await expect(next.locator('.cm-content')).toContainText('Kurz vor dem Aussteigen.')
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
  // Vergleich vor der Entscheidung: die Zeile des Laptops gegen die des Handys
  await b.page.getByRole('button', { name: 'Unterschiede ansehen' }).click()
  const dialog = b.page.getByRole('dialog', { name: 'Unterschiede der beiden Versionen' })
  const diff = dialog.getByTestId('diff-view')
  await expect(diff.locator('[data-kind="removed"]')).toHaveText(/Version 1 – Laptop/)
  await expect(diff.locator('[data-kind="added"]')).toHaveText(/Version 1 – Handy/)
  await expect(diff).toContainText('nur in der anderen Version')
  if (SHOTS) await b.page.screenshot({ path: `${SHOTS}/17-conflict-diff.png` })
  await dialog.getByRole('button', { name: 'Beide behalten' }).click()
  await expect(dialog).toBeHidden()
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

test('Strg+Z holt den Stand eines anderen Geräts nicht zurück', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Benutzername').fill('admin')
  await page.getByLabel('Passwort', { exact: true }).fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Administrator')
  const request = (url: string, method: string, body: object) =>
    page.evaluate(
      async ({ url, method, body }) => {
        const r = await fetch(url, {
          method,
          headers: { 'content-type': 'application/json', 'x-noted-request': '1' },
          body: JSON.stringify(body),
        })
        const data = await r.json()
        if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(data)}`)
        return data.note as { id: string; version: number; content: string }
      },
      { url, method, body },
    )
  const note = await request('/api/notes', 'POST', { title: 'Vorlesung 5', content: 'Absatz eins' })
  await page.goto(`/?n=${note.id}`)
  await expect(page.locator('.cm-content')).toContainText('Absatz eins')

  // Auf dem Handy ergänzt; zurück am Laptop holt die App den neuen Stand
  await request(`/api/notes/${note.id}`, 'PUT', { content: 'Absatz eins\n\nVom Handy', baseVersion: note.version })
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
  await expect(page.locator('.cm-content')).toContainText('Vom Handy')

  // Eigene Eingabe und zweimal Rückgängig: nur die eigene Eingabe verschwindet
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+Home')
  await page.keyboard.insertText('# ')
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  await expect(page.locator('.cm-content')).toContainText('Vom Handy')
  await expect(page.getByTestId('save-status')).toContainText('Gespeichert', { timeout: 10_000 })
  const server = await page.evaluate(async (id) => (await (await fetch(`/api/notes/${id}`)).json()).note.content, note.id)
  expect(server).toBe('Absatz eins\n\nVom Handy')
})

test('PDF-Viewer nach einem App-Update: offline geht ein früher geöffnetes PDF, ein neues meldet sich verständlich', async ({
  page,
  context,
}) => {
  await page.goto('/login')
  await page.getByLabel('Benutzername').fill('admin')
  await page.getByLabel('Passwort', { exact: true }).fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Administrator')
  const headers = await apiHeaders(page)
  const cleanup: string[] = []
  for (const [name, text] of [
    ['Skript Zugfahrt.pdf', 'Thermodynamik'],
    ['Neu Zugfahrt.pdf', 'Noch nie geöffnet'],
  ]) {
    const up = await page.request.post('/api/attachments', {
      headers,
      multipart: { file: { name, mimeType: 'application/pdf', buffer: makePdf([[text]]) } },
    })
    expect(up.status()).toBe(201)
    cleanup.push(`/api/attachments/${(await up.json()).attachment.id}`)
  }
  const res = await page.request.post('/api/notes', {
    headers,
    data: { title: 'Zugfahrt', content: '![[Skript Zugfahrt.pdf]]\n\n![[Neu Zugfahrt.pdf]]\n' },
  })
  const noteId = (await res.json()).note.id as string
  cleanup.unshift(`/api/notes/${noteId}?permanent=1`)

  // Mit Service Worker einmal online öffnen
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
  await page.goto(`/?n=${noteId}`)
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)
  await page.getByRole('radio', { name: 'Lesen' }).click()
  const pdfs = page.locator('.markdown-body a.embed-pdf')
  const panel = page.getByTestId('pdf-panel')
  await pdfs.first().click()
  await expect(panel.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 15_000 })
  await panel.getByRole('button', { name: 'PDF schließen' }).click()

  // Stand nach einem Update: Der neue Service Worker hat die Dateien der alten Version entfernt, und die der neuen
  // hat der Browser noch nie geladen (andere Adressen, also auch nicht in seinem eigenen Cache)
  await page.evaluate(async () => {
    const cache = await caches.open('noted-static')
    for (const request of await cache.keys()) await cache.delete(request)
    localStorage.removeItem('noted:pdfWarm')
  })
  await (await context.newCDPSession(page)).send('Network.clearBrowserCache')
  await page.reload()
  await expect(page.locator('.markdown-body')).toBeVisible()
  // Im Leerlauf lädt die App den PDF-Viewer vorab
  await expect.poll(() => page.evaluate(() => localStorage.getItem('noted:pdfWarm')), { timeout: 20_000 }).toBeTruthy()

  // Im Zug ohne Netz: Das früher geöffnete Skript geht
  await context.setOffline(true)
  await pdfs.first().click()
  await expect(panel.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 15_000 })
  // Ein PDF, das noch nie geöffnet wurde: verständliche Meldung, die App bleibt bedienbar
  await pdfs.nth(1).click()
  await expect(panel).toContainText('Dieses PDF ist offline noch nicht verfügbar. Öffne es einmal mit Verbindung')
  await panel.getByRole('button', { name: 'Schließen', exact: true }).click()
  await expect(panel).toHaveCount(0)
  await expect(page.locator('.markdown-body')).toContainText('Neu Zugfahrt.pdf')

  // Schlimmster Fall – der Viewer konnte nicht vorab geladen werden: eine Meldung statt eines Absturzes der App
  await context.setOffline(false)
  await page.evaluate(async () => {
    const cache = await caches.open('noted-static')
    for (const request of await cache.keys()) await cache.delete(request)
  })
  await (await context.newCDPSession(page)).send('Network.clearBrowserCache')
  await page.reload()
  await expect(page.locator('.markdown-body')).toBeVisible()
  await context.setOffline(true)
  await pdfs.first().click()
  await expect(panel).toContainText('Der PDF-Viewer ist offline noch nicht bereit. Öffne ihn einmal mit Verbindung.')
  await panel.getByRole('button', { name: 'Schließen', exact: true }).click()
  await expect(panel).toHaveCount(0)
  await expect(page.locator('.markdown-body')).toContainText('Skript Zugfahrt.pdf')

  await context.setOffline(false)
  for (const url of cleanup) await page.request.delete(url, { headers })
})

test('PDFs offline verfügbar halten: markieren, ohne Netz öffnen, Löschen räumt den Speicher auf', async ({ page, context }) => {
  await page.goto('/login')
  await page.getByLabel('Benutzername').fill('admin')
  await page.getByLabel('Passwort', { exact: true }).fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Administrator')
  const headers = await apiHeaders(page)
  const ids: Record<string, string> = {}
  for (const [name, text] of [
    ['Klausur Offline.pdf', 'Prüfungsstoff'],
    ['Weg Offline.pdf', 'Wird gelöscht'],
  ]) {
    const up = await page.request.post('/api/attachments', {
      headers,
      multipart: { file: { name, mimeType: 'application/pdf', buffer: makePdf([[text]]) } },
    })
    expect(up.status()).toBe(201)
    ids[name] = (await up.json()).attachment.id
  }
  const cached = () =>
    page.evaluate(async () => (await (await caches.open('noted-data')).keys()).map((r) => decodeURIComponent(new URL(r.url).pathname)))

  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
  await page.goto('/?v=files&in=unlinked')
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)
  // Im Leerlauf lädt die App den PDF-Viewer vorab
  await expect.poll(() => page.evaluate(() => localStorage.getItem('noted:pdfWarm')), { timeout: 20_000 }).toBeTruthy()

  // Vor der Bahnfahrt: das Skript für die Klausur offline verfügbar machen, ohne es zu öffnen
  const card = (name: string) => page.getByTestId('file-card').filter({ hasText: name })
  await card('Klausur Offline.pdf').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Offline verfügbar machen' }).click()
  await expect(page.getByText('„Klausur Offline.pdf“ ist offline verfügbar.')).toBeVisible()
  await expect(card('Klausur Offline.pdf').getByTestId('file-offline')).toBeVisible()
  await expect(card('Weg Offline.pdf').getByTestId('file-offline')).toHaveCount(0)
  await expect.poll(cached).toContain('/api/files/Klausur Offline.pdf')
  // Oben in „Dateien“ steht, wie viel offline gespeichert ist
  await page.getByRole('main').getByRole('navigation', { name: 'Ordnerpfad' }).getByRole('button', { name: 'Dateien' }).click()
  await expect(page.getByRole('heading', { level: 1 }).locator('..')).toContainText('offline gespeichert:')
  await page.goto('/?v=files&in=unlinked')

  // Im Zug ohne Netz: Die App startet aus dem Cache, das markierte PDF geht auf
  await context.setOffline(true)
  await page.reload()
  await expect(card('Klausur Offline.pdf').getByTestId('file-offline')).toBeVisible()
  await card('Klausur Offline.pdf').getByRole('button', { name: 'Im PDF-Viewer öffnen' }).click()
  const panel = page.getByTestId('pdf-panel')
  await expect(panel.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 15_000 })
  await expect(panel.locator('.textLayer').first()).toContainText('Prüfungsstoff')
  // Auch im Menü des Viewers steht, dass es offline bleibt
  await panel.getByRole('button', { name: 'Weitere PDF-Aktionen' }).click()
  await expect(page.getByRole('menuitem', { name: 'Nicht mehr offline halten' })).toBeVisible()
  await page.keyboard.press('Escape')
  await panel.getByRole('button', { name: 'PDF schließen' }).click()
  await context.setOffline(false)

  // Markierung aufheben: Die Datei bleibt im Speicher, bis das Budget sie verdrängt
  await card('Klausur Offline.pdf').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Nicht mehr offline halten' }).click()
  await expect(card('Klausur Offline.pdf').getByTestId('file-offline')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('noted:pdf:offline'))).toBe('[]')
  expect(await cached()).toContain('/api/files/Klausur Offline.pdf')

  // Eine gelöschte Datei verschwindet auch aus dem Offline-Speicher – offline zeigte der Viewer sonst womöglich eine
  // alte Datei gleichen Namens
  await card('Weg Offline.pdf').getByRole('button', { name: 'Im PDF-Viewer öffnen' }).click()
  await expect(panel.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 15_000 })
  await panel.getByRole('button', { name: 'PDF schließen' }).click()
  await expect.poll(cached).toContain('/api/files/Weg Offline.pdf')
  await card('Weg Offline.pdf').getByRole('button', { name: 'Löschen' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Löschen' }).click()
  await expect(card('Weg Offline.pdf')).toHaveCount(0)
  await expect
    .poll(async () => (await cached()).filter((p) => p.includes('Weg Offline.pdf') || p.includes(ids['Weg Offline.pdf'])))
    .toEqual([])
  expect(await cached()).toContain('/api/files/Klausur Offline.pdf')

  await page.request.delete(`/api/attachments/${ids['Klausur Offline.pdf']}`, { headers })
})

test('Großes Skript: Der Viewer zeigt, wie weit es geladen ist', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Benutzername').fill('admin')
  await page.getByLabel('Passwort', { exact: true }).fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Administrator')
  const headers = await apiHeaders(page)
  // Rund 400 KB – bei gedrosselter Verbindung einige Sekunden
  const lines = (page: number) =>
    Array.from({ length: 30 }, (_, j) => `Seite ${page} Zeile ${j + 1}: Die innere Energie eines abgeschlossenen Systems bleibt erhalten.`)
  const up = await page.request.post('/api/attachments', {
    headers,
    multipart: {
      file: { name: 'Skript Gross.pdf', mimeType: 'application/pdf', buffer: makePdf(Array.from({ length: 120 }, (_, i) => lines(i + 1))) },
    },
  })
  expect(up.status()).toBe(201)
  const id = (await up.json()).attachment.id as string

  await page.goto('/?v=files&in=unlinked')
  // Ohne Service Worker, damit die Drosselung des Browsers auch für die Datei gilt
  await page.evaluate(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister()
  })
  await page.reload()
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 50,
    downloadThroughput: 100 * 1024,
    uploadThroughput: 100 * 1024,
  })
  await page.getByTestId('file-card').filter({ hasText: 'Skript Gross.pdf' }).getByRole('button', { name: 'Im PDF-Viewer öffnen' }).click()
  const panel = page.getByTestId('pdf-panel')
  const progress = panel.getByRole('progressbar', { name: 'PDF wird geladen' })
  await expect(progress).toBeVisible({ timeout: 15_000 })
  await expect.poll(async () => Number(await progress.getAttribute('aria-valuenow'))).toBeGreaterThan(0)
  await expect(panel.getByTestId('pdf-progress')).toContainText('%')
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await expect(panel.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 15_000 })
  await expect(panel.getByTestId('pdf-progress')).toHaveCount(0)

  await page.request.delete(`/api/attachments/${id}`, { headers })
})
