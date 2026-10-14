import { expect, test, type Page } from '@playwright/test'

// Karteikarten (aus einer Notiz erstellen, lernen mit Wiederholungsplan, Multiple Choice, offline bewerten)
// und der eingebaute PDF-Viewer neben der Notiz (Seitenlinks, Suche, Zitat in die Notiz).

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

/** Schreibende API-Anfragen wie die App (CSRF-Header) */
async function apiHeaders(page: Page) {
  const me = await page.evaluate(() => fetch('/api/auth/me').then((r) => r.json()))
  return { 'x-noted-request': '1', 'x-noted-user': String(me.user.id) }
}

/** Kleines PDF mit Text (Standardschrift Helvetica) – eine Seite pro Eintrag */
function makePdf(pages: string[][]): Buffer {
  const objects: string[] = ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  const pagesId = 2 + pages.length * 2
  const pageIds: number[] = []
  for (const lines of pages) {
    const text = lines.map((l, i) => `/F1 ${i === 0 ? 24 : 16} Tf (${l.replace(/[()\\]/g, '\\$&')}) Tj T*`).join('\n')
    const stream = `BT 60 760 Td 26 TL\n${text}\nET`
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
    objects.push(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Contents ${objects.length} 0 R /Resources << /Font << /F1 1 0 R >> >> >>`)
    pageIds.push(objects.length)
  }
  objects.push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`)
  objects.push(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)
  let out = '%PDF-1.4\n'
  const offsets = objects.map((o, i) => {
    const offset = out.length
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
    return offset
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

test.describe.configure({ mode: 'serial' })

let consoleErrors: string[] = []
test.beforeEach(({ page }) => {
  consoleErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/status of (401|403|404|409)|ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(msg.text())) {
      consoleErrors.push(msg.text())
    }
  })
  page.on('pageerror', (err) => consoleErrors.push(String(err)))
})
test.afterEach(() => {
  expect(consoleErrors, 'Fehler in der Browser-Konsole').toEqual([])
})

test('Karteikarten aus einer Notiz erstellen und lernen', async ({ page, context }) => {
  await login(page)
  const headers = await apiHeaders(page)
  const res = await page.request.post('/api/notes', {
    headers,
    data: {
      title: 'Folgen und Reihen',
      content: [
        '## Grundbegriffe',
        'Was ist eine Nullfolge?::Eine Folge mit Grenzwert 0',
        '',
        '> [!question]- Was besagt Bolzano-Weierstraß?',
        '> Jede beschränkte Folge hat eine konvergente Teilfolge.',
        '',
        'Welche Aussagen stimmen?',
        '?',
        '- [x] Konvergente Folgen sind beschränkt',
        '- [ ] Beschränkte Folgen konvergieren',
        '- [x] Grenzwerte sind eindeutig',
        '',
      ].join('\n'),
    },
  })
  const noteId = (await res.json()).note.id as string

  await page.goto(`/?n=${noteId}`)
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click()
  await page.getByRole('menuitem', { name: 'Karteikarten aus Notiz …' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Was ist eine Nullfolge?')).toBeVisible()
  await shot(page, '30-cards-from-note')
  await dialog.getByTestId('create-from-note').click()
  await expect(page.getByText('3 Karten erstellt.')).toBeVisible()

  // Übersicht: Stapel mit 3 fälligen (neuen) Karten
  await page.getByRole('button', { name: /^Karteikarten/ }).first().click()
  const tile = page.getByTestId('deck-list').locator('> div').filter({ hasText: 'Folgen und Reihen' })
  await expect(tile).toContainText('3 fällig')
  await tile.getByRole('button', { name: /Folgen und Reihen/ }).click()

  // Karte von Hand ergänzen (beidseitig)
  await page.getByTestId('add-card').click()
  await dialog.getByRole('radio', { name: 'Beidseitig' }).click()
  await dialog.getByTestId('card-front').fill('Folge')
  await dialog.getByTestId('card-back').fill('sequence')
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click()
  await expect(page.getByTestId('card-list').locator('> li')).toHaveCount(4)
  await shot(page, '31-deck')

  // Lernen: alle Karten mit „Einfach“ bzw. richtig beantworten → sofort im Wiederholungsplan
  await page.getByTestId('deck-learn').click()
  await expect(page.getByTestId('study')).toBeVisible()
  for (let i = 0; i < 4; i++) {
    const card = page.getByTestId('study-card')
    if (await page.getByRole('button', { name: 'Prüfen' }).isVisible()) {
      await card.getByRole('checkbox', { name: /Konvergente Folgen sind beschränkt/ }).click()
      await card.getByRole('checkbox', { name: /Grenzwerte sind eindeutig/ }).click()
      await page.keyboard.press('Enter')
      await expect(page.getByTestId('study-answer')).toContainText('Richtig!')
      await shot(page, '32-study-mc')
    } else {
      await page.keyboard.press('Space')
      await expect(page.getByTestId('study-answer')).toBeVisible()
    }
    await expect(page.getByTestId('rate-4')).toContainText('4 Tage')
    await page.getByTestId('rate-4').click()
  }
  await expect(page.getByTestId('study-done')).toContainText('Geschafft!')

  // Bewertungen landen auf dem Server
  await expect
    .poll(async () => {
      const data = await page.evaluate(() => fetch('/api/flashcards').then((r) => r.json()))
      return data.reviews.filter((r: { phase: string }) => r.phase === 'review').length
    })
    .toBe(4)

  // Offline lernen: Bewertungen werden gesammelt und später gesendet
  await page.getByRole('button', { name: 'Alle Karten üben' }).click()
  await page.getByRole('button', { name: 'Lernen beenden' }).click()
  await page.getByRole('button', { name: 'Stapel-Aktionen' }).click()
  await page.getByRole('menuitem', { name: 'Lernstand zurücksetzen …' }).click()
  await dialog.getByRole('button', { name: 'Zurücksetzen' }).click()
  await expect(page.getByText('Lernstand zurückgesetzt.')).toBeVisible()
  await context.setOffline(true)
  await page.getByTestId('deck-learn').click()
  await page.keyboard.press('Space')
  await page.getByTestId('rate-3').click()
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('noted:reviews:')))).toBe(true)
  await context.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect
    .poll(async () => (await page.evaluate(() => fetch('/api/flashcards').then((r) => r.json()))).reviews.length, { timeout: 15_000 })
    .toBe(1)
})

test('PDF neben der Notiz lesen, verlinken und zitieren', async ({ page }) => {
  await login(page)
  const headers = await apiHeaders(page)
  const pdf = makePdf([
    ['Vorlesung 4', 'Stetigkeit'],
    ['Zwischenwertsatz', 'Jede stetige Funktion nimmt jeden Zwischenwert an.'],
    ['Satz vom Maximum', 'Stetige Funktionen auf kompakten Mengen nehmen ein Maximum an.'],
  ])
  const up = await page.request.post('/api/attachments', {
    headers,
    multipart: { file: { name: 'Skript Stetigkeit.pdf', mimeType: 'application/pdf', buffer: pdf } },
  })
  expect(up.status()).toBe(201)
  const res = await page.request.post('/api/notes', {
    headers,
    data: { title: 'Stetigkeit', content: 'Skript: ![[Skript Stetigkeit.pdf]]\n\nSiehe [[Skript Stetigkeit.pdf#page=3]]\n' },
  })
  const noteId = (await res.json()).note.id as string

  await page.goto(`/?n=${noteId}`)
  await page.getByRole('radio', { name: 'Lesen' }).click()
  await page.locator('.markdown-body a.embed-pdf').click()
  const panel = page.getByTestId('pdf-panel')
  await expect(panel.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 15_000 })
  const pageInput = panel.getByLabel('Seite', { exact: true })
  await expect(pageInput).toHaveValue('1')
  // Die Notiz bleibt daneben sichtbar
  await expect(page.locator('.markdown-body a.file-link-pdf')).toBeVisible()

  // Seitenlink springt im offenen PDF auf Seite 3
  await page.locator('.markdown-body a.file-link-pdf').click()
  await expect(pageInput).toHaveValue('3')

  // Suche im PDF
  await panel.getByRole('button', { name: 'Im PDF suchen' }).click()
  await panel.getByPlaceholder('Im PDF suchen …').fill('stetige')
  await expect(panel.getByText(/^\d+ \/ 2$/)).toBeVisible()
  await shot(page, '33-pdf-split')
  await panel.getByRole('button', { name: 'Suche schließen' }).click()

  // Text auf Seite 2 markieren und als Zitat mit Seitenlink in die Notiz übernehmen
  await pageInput.fill('2')
  await pageInput.press('Enter')
  await expect(pageInput).toHaveValue('2')
  await expect(panel.locator('.textLayer span', { hasText: 'Jede stetige Funktion' })).toHaveCount(1)
  await page.evaluate(() => {
    const span = [...document.querySelectorAll('.textLayer span')].find((s) => s.textContent?.includes('Jede stetige Funktion'))!
    const range = document.createRange()
    range.selectNodeContents(span)
    getSelection()!.removeAllRanges()
    getSelection()!.addRange(range)
  })
  await panel.getByTestId('pdf-selection').getByRole('button', { name: /Zitieren/ }).click()
  await expect(page.getByText('Zitat in „Stetigkeit“ eingefügt.')).toBeVisible()
  await expect(page.locator('.markdown-body blockquote')).toContainText('Jede stetige Funktion nimmt jeden Zwischenwert an.')
  await expect
    .poll(async () => (await page.evaluate((id) => fetch(`/api/notes/${id}`).then((r) => r.json()), noteId)).note.content)
    .toContain('> [[Skript Stetigkeit.pdf#page=2|S. 2]]')

  // Panel bleibt beim Neuladen offen und lässt sich schließen
  await page.reload()
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: 'PDF schließen' }).click()
  await expect(panel).toHaveCount(0)
})
