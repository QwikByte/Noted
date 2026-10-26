import { expect, test, type Page } from '@playwright/test'
import { apiHeaders, makePdf } from './helpers'

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
  await page.getByRole('link', { name: /^Karteikarten/ }).first().click()
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
    // „Einfach“ plant 4 Tage, je Karte leicht gestreut (3–5 Tage), damit gemeinsam gelernte Karten auseinanderlaufen
    await expect(page.getByTestId('rate-4')).toContainText(/(?<!\d)[345] Tage/)
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
  // Erst tippen, wenn die Lernansicht da ist – sonst geht die Leertaste je nach Auslastung ins Leere
  await expect(page.getByTestId('study')).toBeVisible()
  await page.keyboard.press('Space')
  await page.getByTestId('rate-3').click()
  const pendingReviews = () =>
    page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.startsWith('noted:reviews:'))
      return key ? (JSON.parse(localStorage.getItem(key)!).pending?.length ?? 0) : 0
    })
  await expect.poll(pendingReviews).toBe(1)
  await context.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect
    .poll(async () => (await page.evaluate(() => fetch('/api/flashcards').then((r) => r.json()))).reviews.length, { timeout: 15_000 })
    .toBe(1)
  await expect.poll(pendingReviews).toBe(0)
})

test('Notiz und Karten abgleichen: neue Antwort übernehmen, Lernstand bleibt, verwaiste Karte lösen', async ({ page }) => {
  await login(page)
  const headers = await apiHeaders(page)
  const post = async (url: string, data: unknown) => (await page.request.post(url, { headers, data })).json()
  const content = 'Was ist ein Körper?::Menge mit + und ·\nWas ist ein Modul?::Vektorraum über einem Ring\n'
  const note = (await post('/api/notes', { title: 'Abgleich Algebra', content })).note as { id: string }
  const deck = (await post('/api/decks', { name: 'Abgleich Algebra' })).deck as { id: string }
  const [field, module] = (
    await post(`/api/decks/${deck.id}/cards`, {
      cards: [
        { type: 'basic', front: 'Was ist ein Körper?', back: 'Menge mit + und ·', noteId: note.id },
        { type: 'basic', front: 'Was ist ein Modul?', back: 'Vektorraum über einem Ring', noteId: note.id },
      ],
    })
  ).cards as { id: string }[]
  // Lernstand der ersten Karte: in 10 Tagen wieder dran
  const now = Date.now()
  const state = { phase: 'review', step: 0, interval: 10, ease: 2.5, reps: 3, lapses: 0, reviewedAt: now, introducedAt: now }
  await post('/api/reviews', { reviews: [{ cardId: field.id, side: 0, ...state, due: now + 10 * 86_400_000 }] })
  // In der Notiz: Antwort präzisiert, Modul gestrichen
  const precise = 'Kommutativer Ring, in dem jedes Element außer 0 invertierbar ist'
  await page.request.put(`/api/notes/${note.id}`, { headers, data: { content: `Was ist ein Körper?::${precise}\n` } })

  await page.goto(`/?n=${note.id}`)
  await page.getByRole('radio', { name: 'Lesen' }).click()
  await page.getByRole('button', { name: '2 Karten veraltet – abgleichen' }).click()
  const dialog = page.getByRole('dialog', { name: 'Karteikarten aus Notiz' })
  const changed = dialog.getByTestId('cards-changed')
  await expect(changed.getByTestId('card-before')).toContainText('Menge mit + und ·')
  await expect(changed.getByTestId('card-after')).toContainText(precise)
  await expect(changed).toContainText('Antwort geändert')
  await expect(changed.getByRole('checkbox', { name: '„Was ist ein Körper?“ aktualisieren' })).toBeChecked()
  const orphaned = dialog.getByTestId('cards-orphaned')
  await expect(orphaned).toContainText('Was ist ein Modul?')
  // Nichts ist für verwaiste Karten vorausgewählt
  const action = orphaned.getByLabel('„Was ist ein Modul?“: was tun?')
  await expect(action).toHaveValue('keep')
  await action.selectOption('unlink')
  await shot(page, '33-cards-sync')
  await dialog.getByTestId('create-from-note').click()
  await expect(page.getByText('Karten abgeglichen: 1 aktualisiert, 1 von der Notiz gelöst.')).toBeVisible()
  await expect(page.getByText('1 Karteikarte aus dieser Notiz')).toBeVisible()
  await expect(page.getByRole('button', { name: /veraltet – abgleichen/ })).toHaveCount(0)

  // Auf dem Server: neue Antwort, Lernstand unverändert, Modul ohne Notiz
  const data = await page.evaluate(() => fetch('/api/flashcards').then((r) => r.json()))
  const cards = data.cards as { id: string; back: string; noteId: string | null }[]
  expect(cards.find((c) => c.id === field.id)).toMatchObject({ back: precise, noteId: note.id })
  expect(cards.find((c) => c.id === module.id)).toMatchObject({ noteId: null })
  expect(data.reviews.find((r: { cardId: string }) => r.cardId === field.id)).toMatchObject({ interval: 10, reps: 3 })

  await page.request.delete(`/api/decks/${deck.id}`, { headers })
  await page.request.delete(`/api/notes/${note.id}?permanent=1`, { headers })
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
  await panel.getByTestId('pdf-selection').getByRole('button', { name: 'Als Zitat einfügen' }).click()
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

test('PDF-Viewer räumt beim Schließen auf und lässt Bilder für die Notiz in Ruhe', async ({ page }) => {
  await login(page)
  const headers = await apiHeaders(page)
  const up = await page.request.post('/api/attachments', {
    headers,
    multipart: { file: { name: 'Skript Aufräumen.pdf', mimeType: 'application/pdf', buffer: makePdf([['Seite eins'], ['Seite zwei']]) } },
  })
  expect(up.status()).toBe(201)
  const res = await page.request.post('/api/notes', { headers, data: { title: 'Aufräumen', content: '![[Skript Aufräumen.pdf]]\n' } })
  const noteId = (await res.json()).note.id as string

  // Listener am Dokument zählen (wie die Entwicklerwerkzeuge)
  const cdp = await page.context().newCDPSession(page)
  const listeners = async (type: string) => {
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'document' })
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId! })
    return listeners.filter((l) => l.type === type).length
  }

  // Ausgangslage im Editor – CodeMirror hat eigene Listener am Dokument
  await page.goto(`/?n=${noteId}`)
  await page.getByRole('radio', { name: 'Bearbeiten' }).click()
  await expect(page.locator('.cm-content')).toBeVisible()
  const before = { drop: await listeners('drop'), selection: await listeners('selectionchange') }
  await page.getByRole('radio', { name: 'Lesen' }).click()
  await page.locator('.markdown-body a.embed-pdf').click()
  const panel = page.getByTestId('pdf-panel')
  await expect(panel.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 15_000 })
  // pdf.js hängt keinen eigenen Drop-Handler an das Dokument
  expect(await listeners('drop')).toBe(before.drop)

  // Ein Bild, das in die Notiz gezogen wird, landet nicht als Stempel im PDF
  await page.getByRole('radio', { name: 'Bearbeiten' }).click()
  await page.evaluate(() => {
    const png = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
      (c) => c.charCodeAt(0),
    )
    const data = new DataTransfer()
    data.items.add(new File([png], 'Foto.png', { type: 'image/png' }))
    document.querySelector('.cm-content')!.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }))
  })
  await expect(page.locator('.cm-content')).toContainText('.png]]')
  await expect(panel.locator('.stampEditor')).toHaveCount(0)

  // Nach dem Schließen sind keine Listener des Viewers übrig
  await panel.getByRole('button', { name: 'PDF schließen' }).click()
  await expect(panel).toHaveCount(0)
  expect(await listeners('drop')).toBe(before.drop)
  expect(await listeners('selectionchange')).toBe(before.selection)
})

test('PDF: Auswahl über eine Seitengrenze markieren und zitieren', async ({ page }) => {
  await login(page)
  const headers = await apiHeaders(page)
  const up = await page.request.post('/api/attachments', {
    headers,
    multipart: {
      file: {
        name: 'Skript Grenze.pdf',
        mimeType: 'application/pdf',
        buffer: makePdf([
          ['Seite eins', 'Ende des Satzes'],
          ['Anfang zwei', 'Rest'],
        ]),
      },
    },
  })
  expect(up.status()).toBe(201)
  const attachmentId = (await up.json()).attachment.id as string
  const res = await page.request.post('/api/notes', { headers, data: { title: 'Grenze', content: '![[Skript Grenze.pdf]]\n' } })
  const noteId = (await res.json()).note.id as string

  await page.goto(`/?n=${noteId}`)
  await page.getByRole('radio', { name: 'Lesen' }).click()
  await page.locator('.markdown-body a.embed-pdf').click()
  const panel = page.getByTestId('pdf-panel')
  const span = (n: number, text: string) => panel.locator(`.page[data-page-number="${n}"] .textLayer span`, { hasText: text })
  await expect(span(1, 'Ende des Satzes')).toHaveCount(1, { timeout: 15_000 })
  // Seite 2 zeichnen lassen; Seite 1 bleibt gezeichnet
  const pageInput = panel.getByLabel('Seite', { exact: true })
  await pageInput.fill('2')
  await pageInput.press('Enter')
  await expect(span(2, 'Anfang zwei')).toHaveCount(1)
  await expect(span(1, 'Ende des Satzes')).toHaveCount(1)

  // Vom Ende der ersten bis zum Anfang der zweiten Seite auswählen
  const select = () =>
    page.evaluate(() => {
      const find = (n: number, text: string) =>
        [...document.querySelectorAll(`.page[data-page-number="${n}"] .textLayer span`)].find((s) => s.textContent?.includes(text))!
      const range = document.createRange()
      range.setStart(find(1, 'Ende des Satzes').firstChild!, 0)
      range.setEnd(find(2, 'Anfang zwei').firstChild!, 'Anfang zwei'.length)
      getSelection()!.removeAllRanges()
      getSelection()!.addRange(range)
    })
  await select()
  const bar = panel.getByTestId('pdf-selection')
  await expect(bar).toContainText('Ende des Satzes')
  await expect(bar).toContainText('Anfang zwei')

  // Markieren: je Seite eine Markierung
  await bar.getByRole('button', { name: 'Markieren' }).click()
  await expect(panel.locator('.page[data-page-number="1"] .pdf-annotation')).toHaveCount(1)
  await expect(panel.locator('.page[data-page-number="2"] .pdf-annotation')).toHaveCount(1)
  await expect
    .poll(async () => {
      const list = (await page.evaluate((id) => fetch(`/api/attachments/${id}/annotations`).then((r) => r.json()), attachmentId))
        .annotations as { page: number; quote: string }[]
      return list.map((a) => `${a.page}: ${a.quote}`).sort()
    })
    .toEqual(['1: Ende des Satzes', '2: Anfang zwei'])

  // Als Zitat: der Text beider Seiten, verlinkt auf die erste
  await select()
  await bar.getByRole('button', { name: 'Als Zitat einfügen' }).click()
  await expect(page.locator('.markdown-body blockquote')).toContainText('Ende des Satzes')
  await expect(page.locator('.markdown-body blockquote')).toContainText('Anfang zwei')
  await expect
    .poll(async () => (await page.evaluate((id) => fetch(`/api/notes/${id}`).then((r) => r.json()), noteId)).note.content)
    .toContain('[[Skript Grenze.pdf#page=1|S. 1]]')
})

test('PDF-Viewer mit der Tastatur: suchen, blättern, zoomen und markieren', async ({ page }) => {
  await login(page)
  const headers = await apiHeaders(page)
  const pdf = makePdf([['Kapitel eins', 'Welle und Teilchen'], ['Kapitel zwei', 'Welle im Medium'], ['Kapitel drei', 'Zusammenfassung']])
  const up = await page.request.post('/api/attachments', {
    headers,
    multipart: { file: { name: 'Skript Tastatur.pdf', mimeType: 'application/pdf', buffer: pdf } },
  })
  expect(up.status()).toBe(201)
  const res = await page.request.post('/api/notes', { headers, data: { title: 'Tastatur', content: '![[Skript Tastatur.pdf]]\n' } })
  const noteId = (await res.json()).note.id as string
  await page.goto(`/?n=${noteId}`)
  await page.getByRole('radio', { name: 'Lesen' }).click()
  await page.locator('.markdown-body a.embed-pdf').click()
  const panel = page.getByTestId('pdf-panel')
  await expect(panel.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 15_000 })
  const pages = panel.locator('.pdf-container')

  // Strg+F im PDF: die Suche des PDFs (nicht die des Browsers), F3 zum nächsten Treffer
  await pages.focus()
  await page.keyboard.press('Control+f')
  const input = panel.getByPlaceholder('Im PDF suchen …')
  await expect(input).toBeFocused()
  await page.keyboard.type('Welle')
  const counter = panel.getByRole('status')
  await expect(counter).toHaveText('1 / 2')
  await page.keyboard.press('F3')
  await expect(counter).toHaveText('2 / 2')
  await page.keyboard.press('Escape')
  await expect(input).toHaveCount(0)

  // Blättern und zoomen
  await pages.focus()
  const pageInput = panel.getByLabel('Seite', { exact: true })
  await page.keyboard.press('Home')
  await expect(pageInput).toHaveValue('1')
  await page.keyboard.press('ArrowRight')
  await expect(pageInput).toHaveValue('2')
  await page.keyboard.press('End')
  await expect(pageInput).toHaveValue('3')
  const width = async () => (await panel.locator('.page[data-page-number="3"]').boundingBox())!.width
  const fitted = await width()
  await page.keyboard.press('+')
  await expect.poll(width).toBeGreaterThan(fitted + 10)
  await page.keyboard.press('0')
  await expect.poll(async () => Math.round(await width())).toBe(Math.round(fitted))

  // Ausgewählten Text mit Strg+Umschalt+H markieren
  await expect(panel.locator('.page[data-page-number="3"] .textLayer span', { hasText: 'Zusammenfassung' })).toHaveCount(1)
  await page.evaluate(() => {
    const span = [...document.querySelectorAll('.page[data-page-number="3"] .textLayer span')].find((s) =>
      s.textContent?.includes('Zusammenfassung'),
    )!
    const range = document.createRange()
    range.selectNodeContents(span)
    getSelection()!.removeAllRanges()
    getSelection()!.addRange(range)
  })
  await expect(panel.getByTestId('pdf-selection')).toBeVisible()
  await page.keyboard.press('Control+Shift+H')
  await expect(panel.locator('.page[data-page-number="3"] .pdf-annotation')).toHaveCount(1)

  // Im Editor bleibt Strg+F die Suche des Editors
  await page.getByRole('radio', { name: 'Bearbeiten' }).click()
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+f')
  await expect(page.locator('.cm-search')).toBeVisible()
  await expect(input).toHaveCount(0)
})
