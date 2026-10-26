import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import Database from 'better-sqlite3'
import { strToU8, zipSync } from 'fflate'
import { apiHeaders, makePdf } from './helpers'

// Lernhilfen: Antwort eintippen, Problemkarten, Notiz abfragen, Fokus aus dem Termin und Karteikarten nach der
// Vorlesung auf der Startseite.

const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'E2E-Admin-Passwort-1'
const SHOTS = process.env.SCREENSHOT_DIR
const DAY = 86_400_000

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

type Created = { id: string }

async function post<T = Created>(page: Page, url: string, data: object, key: string): Promise<T> {
  const res = await page.request.post(url, { headers: await apiHeaders(page), data })
  expect(res.ok()).toBe(true)
  return (await res.json())[key] as T
}

const flashcards = (page: Page) => page.evaluate(() => fetch('/api/flashcards').then((r) => r.json()))

test.describe.configure({ mode: 'serial' })

let consoleErrors: string[] = []
// Alle Specs teilen sich das Admin-Konto: Was hier entsteht, wird wieder entfernt
const cleanup: string[] = []
test.beforeEach(({ page }) => {
  consoleErrors = []
  page.on('console', (msg) => {
    // Ohne Verbindung (PDF-Anmerkungen) scheitern Anfragen absichtlich
    if (msg.type() === 'error' && !/status of (401|403|404|409)|ERR_INTERNET_DISCONNECTED/.test(msg.text())) {
      consoleErrors.push(msg.text())
    }
  })
  page.on('pageerror', (err) => consoleErrors.push(String(err)))
})
test.afterEach(async ({ page }) => {
  const headers = await apiHeaders(page)
  for (const url of cleanup.splice(0)) await page.request.delete(url, { headers })
  const { events } = await (await page.request.get('/api/calendar')).json()
  for (const e of events) await page.request.delete(`/api/calendar/${e.id}`, { headers })
  expect(consoleErrors, 'Fehler in der Browser-Konsole').toEqual([])
})

test('Antwort eintippen: Unterschiede markieren und Bewertung vorauswählen', async ({ page }) => {
  await login(page)
  const deck = await post(page, '/api/decks', { name: 'Vokabeln', typeAnswer: true }, 'deck')
  cleanup.push(`/api/decks/${deck.id}`)
  const [house, tree] = await post<Created[]>(
    page,
    `/api/decks/${deck.id}/cards`,
    { cards: [{ type: 'basic', front: 'Haus', back: '**house**' }, { type: 'basic', front: 'Baum', back: 'tree' }] },
    'cards',
  )

  await page.goto(`/?s=deck:${deck.id}`)
  const card = page.getByTestId('study-card')
  const input = page.getByTestId('typed-answer')
  const result = page.getByTestId('typed-result')
  await expect(card).toContainText('Haus')
  await expect(input).toBeFocused()
  await input.fill('House')
  await input.press('Enter')
  await expect(result).toContainText('Richtig eingetippt')
  await expect(page.getByTestId('rate-3')).toHaveClass(/ring-accent/)
  await page.keyboard.press('Enter')

  await expect(card).toContainText('Baum')
  await input.fill('trea')
  await page.getByTestId('reveal').click()
  await expect(result).toContainText('Nicht ganz')
  await expect(result.locator('del')).toHaveText('a')
  await expect(result.locator('ins')).toHaveText('e')
  await expect(page.getByTestId('rate-1')).toHaveClass(/ring-accent/)
  await shot(page, '34-typed-answer')
  await page.keyboard.press('Enter')

  // „Gut“ führt zum nächsten Lernschritt, „Nochmal“ zurück auf den ersten
  await expect
    .poll(
      async () => {
        const { reviews } = await flashcards(page)
        const step = (id: string) => reviews.find((r: { cardId: string }) => r.cardId === id)?.step
        return [step(house.id), step(tree.id)]
      },
      { timeout: 15_000 },
    )
    .toEqual([1, 0])
})

test('Problemkarten erkennen, aussetzen und neu lernen', async ({ page }) => {
  await login(page)
  const deck = await post(page, '/api/decks', { name: 'Problemfälle' }, 'deck')
  cleanup.push(`/api/decks/${deck.id}`)
  const [hard, easy] = await post<Created[]>(
    page,
    `/api/decks/${deck.id}/cards`,
    { cards: [{ type: 'basic', front: 'Nenne alle Körperaxiome', back: 'Neun Stück …' }, { type: 'basic', front: 'Leicht', back: 'Ja' }] },
    'cards',
  )
  const now = Date.now()
  const learned = (lapses: number) => ({
    phase: 'review',
    step: 0,
    interval: 1,
    ease: 1.3,
    reps: 12,
    lapses,
    due: now - 60_000,
    reviewedAt: now - DAY,
    introducedAt: now - 30 * DAY,
  })
  await post(page, '/api/reviews', { reviews: [{ cardId: hard.id, side: 0, ...learned(6) }, { cardId: easy.id, side: 0, ...learned(0) }] }, 'saved')

  await page.goto(`/?d=${deck.id}`)
  const filters = page.getByRole('radiogroup', { name: 'Karten filtern' })
  await filters.getByRole('radio', { name: /Problemkarten/ }).click()
  await expect(page.getByTestId('problem-hint')).toBeVisible()
  const items = page.getByTestId('card-list').locator('> li')
  await expect(items).toHaveCount(1)
  await expect(items.first()).toContainText('Problemkarte · 6× vergessen')
  await shot(page, '35-problem-cards')

  await items.first().getByRole('button', { name: 'Aussetzen' }).click()
  await expect(page.getByText('Karte ausgesetzt')).toBeVisible()
  await expect(items.first()).toContainText('Ausgesetzt')

  // Ausgesetzte Karten kommen beim Lernen nicht dran
  await page.getByTestId('deck-learn').click()
  await expect(page.getByTestId('study-card')).toContainText('Leicht')
  await page.keyboard.press('Space')
  await page.getByTestId('rate-3').click()
  await expect(page.getByTestId('study-done')).toBeVisible()
  await page.getByRole('button', { name: 'Fertig' }).click()

  // Neu lernen: Lernstand weg, nicht mehr ausgesetzt – damit ist sie auch keine Problemkarte mehr
  await filters.getByRole('radio', { name: /Ausgesetzt/ }).click()
  await items.first().getByRole('button', { name: 'Neu lernen' }).click()
  await expect(page.getByText('Die Karte gilt wieder als neu.')).toBeVisible()
  await expect(filters).toHaveCount(0)
  const data = await flashcards(page)
  expect(data.cards.find((c: Created) => c.id === hard.id).suspended).toBe(false)
  expect(data.reviews.find((r: { cardId: string }) => r.cardId === hard.id)).toBeUndefined()
})

test('Eigene Übung: heute vergessene Karte gezielt üben, ohne den Lernplan zu ändern', async ({ page }) => {
  await login(page)
  const deck = await post(page, '/api/decks', { name: 'Gezielt üben' }, 'deck')
  cleanup.push(`/api/decks/${deck.id}`)
  await post(page, `/api/decks/${deck.id}/cards`, { cards: [{ type: 'basic', front: 'Vergessene Frage', back: 'A' }, { type: 'basic', front: 'Gewusste Frage', back: 'B' }] }, 'cards')

  // Lernen: die erste Karte mit „Nochmal“ bewerten
  await page.goto(`/?d=${deck.id}`)
  await page.getByTestId('deck-learn').click()
  await expect(page.getByTestId('study-card')).toContainText('Vergessene Frage')
  await page.keyboard.press('Space')
  await page.getByTestId('rate-1').click()
  await expect(page.getByTestId('study-card')).toContainText('Gewusste Frage')

  // Stapel → Üben → „Heute vergessen“: genau diese Karte
  await page.goto(`/?d=${deck.id}`)
  await page.getByRole('button', { name: /^Üben/ }).click()
  await expect(page.getByRole('menuitem', { name: 'Problemkarten (0)' })).toBeDisabled()
  await page.getByRole('menuitem', { name: 'Heute vergessen (1)' }).click()
  await expect(page).toHaveURL(/filter=again-today/)
  await expect(page.getByText('Gezielt üben · Heute vergessen')).toBeVisible()
  await expect(page.getByTestId('study-card')).toContainText('Vergessene Frage')
  await shot(page, '36-practice-again')
  // Neu laden: dieselbe Übung
  await page.reload()
  await expect(page.getByTestId('study-card')).toContainText('Vergessene Frage')
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Gewusst', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Übung beendet' })).toBeVisible()

  // Üben ändert den Plan nicht: Die Karte ist weiter in der Lernphase
  const states = await page.evaluate(() => fetch('/api/flashcards').then((r) => r.json()))
  const forgotten = states.cards.find((c: { front: string }) => c.front === 'Vergessene Frage')
  const review = states.reviews.find((r: { cardId: string }) => r.cardId === forgotten.id)
  expect(review?.phase ?? 'learning').toBe('learning')
})

test('Jede Karte aussetzen: im Stapel über „⋮“ und mitten in der Lernsitzung', async ({ page }) => {
  await login(page)
  const deck = await post(page, '/api/decks', { name: 'Aussetzen' }, 'deck')
  cleanup.push(`/api/decks/${deck.id}`)
  await post<Created[]>(
    page,
    `/api/decks/${deck.id}/cards`,
    {
      cards: [
        { type: 'basic', front: 'Nicht klausurrelevant', back: 'a' },
        { type: 'basic', front: 'Später überarbeiten', back: 'b' },
        { type: 'basic', front: 'Bleibt', back: 'c' },
      ],
    },
    'cards',
  )
  await page.goto(`/?d=${deck.id}`)
  const items = page.getByTestId('card-list').locator('> li')
  const first = items.filter({ hasText: 'Nicht klausurrelevant' })
  await first.getByRole('button', { name: 'Weitere Aktionen' }).click()
  await page.getByRole('menuitem', { name: 'Aussetzen' }).click()
  await expect(page.getByText('Karte ausgesetzt')).toBeVisible()
  await expect(first).toContainText('Ausgesetzt')
  await expect(page.getByRole('radiogroup', { name: 'Karten filtern' }).getByRole('radio', { name: /Ausgesetzt/ })).toBeVisible()

  // In der Lernsitzung: die angezeigte Karte aussetzen – weiter mit der nächsten
  await page.getByTestId('deck-learn').click()
  const studyCard = page.getByTestId('study-card')
  await expect(studyCard).toContainText('Später überarbeiten')
  await page.getByRole('button', { name: 'Karte aussetzen' }).click()
  await expect(studyCard).toContainText('Bleibt')
  await expect(page.getByText('im Stapel unter „Ausgesetzt“')).toBeVisible()
  // Die Leertaste deckt auf (setzt nicht die nächste Karte aus); „Einfach“ – sonst käme die neue Karte gleich wieder
  await page.keyboard.press('Space')
  await page.getByTestId('rate-4').click()
  await expect(page.getByTestId('study-done')).toBeVisible()
  const { cards } = await flashcards(page)
  const suspended = (front: string) => cards.find((c: { front: string }) => c.front === front).suspended
  expect([suspended('Nicht klausurrelevant'), suspended('Später überarbeiten'), suspended('Bleibt')]).toEqual([true, true, false])
})

test('Lernen: letzte Bewertung rückgängig – mehrfach und auch nach der letzten Karte', async ({ page }) => {
  await login(page)
  const deck = await post(page, '/api/decks', { name: 'Vertippt' }, 'deck')
  cleanup.push(`/api/decks/${deck.id}`)
  const [first, second] = await post<Created[]>(
    page,
    `/api/decks/${deck.id}/cards`,
    { cards: [{ type: 'basic', front: 'Erste Frage', back: 'a' }, { type: 'basic', front: 'Zweite Frage', back: 'b' }] },
    'cards',
  )
  const total = async () => (await (await page.request.get('/api/stats?tz=UTC')).json()).total as number
  const loggedBefore = await total()

  await page.goto(`/?s=deck:${deck.id}`)
  const studyCard = page.getByTestId('study-card')
  const counts = page.getByRole('group', { name: 'Verbleibend' })
  const undo = page.getByRole('button', { name: 'Letzte Bewertung rückgängig' })
  await expect(studyCard).toContainText('Erste Frage')
  await expect(undo).toBeDisabled()
  const countsBefore = (await counts.textContent()) ?? ''

  // Versehentlich „Nochmal“: Rückgängig zeigt dieselbe Karte verdeckt, die Zähler sind wie vorher
  await page.keyboard.press('Space')
  await page.getByTestId('rate-1').click()
  await expect(studyCard).toContainText('Zweite Frage')
  await expect(counts).not.toHaveText(countsBefore)
  await undo.click()
  await expect(page.getByText('Bewertung zurückgenommen.')).toBeVisible()
  await expect(studyCard).toContainText('Erste Frage')
  await expect(page.getByTestId('study-answer')).toHaveCount(0)
  await expect(counts).toHaveText(countsBefore)
  await expect(undo).toBeDisabled()

  // Beide richtig, dann nach der letzten Karte per Tastatur zurück – zweimal bis zur ersten
  await page.keyboard.press('Space')
  await page.getByTestId('rate-4').click()
  await expect(studyCard).toContainText('Zweite Frage')
  await page.keyboard.press('Space')
  await page.getByTestId('rate-4').click()
  await expect(page.getByTestId('study-done')).toBeVisible()
  await page.keyboard.press('z')
  await expect(studyCard).toContainText('Zweite Frage')
  await page.keyboard.press('Control+z')
  await expect(studyCard).toContainText('Erste Frage')
  await expect(counts).toHaveText(countsBefore)
  await page.keyboard.press('Space')
  await page.getByTestId('rate-4').click()
  await expect(studyCard).toContainText('Zweite Frage')

  // Auf dem Server: nur die letzte Bewertung der ersten Karte, die zweite ist wieder neu
  await expect
    .poll(
      async () => {
        const { reviews } = await flashcards(page)
        const of = (id: string) => reviews.find((r: { cardId: string }) => r.cardId === id)
        return [of(first.id)?.lapses, of(second.id)]
      },
      { timeout: 15_000 },
    )
    .toEqual([0, undefined])
  await expect.poll(total, { timeout: 15_000 }).toBe(loggedBefore + 1)
})

test('Karteneditor: Bilder einfügen und hineinziehen', async ({ page }) => {
  await login(page)
  const deck = await post(page, '/api/decks', { name: 'Folien' }, 'deck')
  cleanup.push(`/api/decks/${deck.id}`)
  await page.goto(`/?d=${deck.id}`)
  await page.getByTestId('add-card').click()
  const dialog = page.getByRole('dialog')
  const front = dialog.getByTestId('card-front')
  const back = dialog.getByTestId('card-back')
  await front.fill('Welche Schicht zeigt die Folie? ')
  // Ein Screenshot aus der Zwischenablage bzw. eine Datei aus dem Dateimanager
  const send = (testId: string, type: 'paste' | 'drop', name: string) =>
    page.evaluate(
      ({ testId, type, name }) => {
        const png = Uint8Array.from(
          atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
          (c) => c.charCodeAt(0),
        )
        const data = new DataTransfer()
        data.items.add(new File([png], name, { type: 'image/png' }))
        const el = document.querySelector(`[data-testid="${testId}"]`)!
        const init = { bubbles: true, cancelable: true }
        el.dispatchEvent(type === 'paste' ? new ClipboardEvent('paste', { ...init, clipboardData: data }) : new DragEvent('drop', { ...init, dataTransfer: data }))
      },
      { testId, type, name },
    )
  await front.focus()
  await send('card-front', 'paste', 'Folie 3.png')
  await expect(front).toHaveValue('Welche Schicht zeigt die Folie? ![[Folie 3.png]]')
  await send('card-back', 'drop', 'Lösung.png')
  await expect(back).toHaveValue('![[Lösung.png]]')
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const item = page.getByTestId('card-list').locator('> li').first()
  await expect(item.locator('img')).toHaveCount(2)
  const { attachments } = await (await page.request.get('/api/attachments')).json()
  for (const a of attachments as { id: string; filename: string }[]) {
    if (['Folie 3.png', 'Lösung.png'].includes(a.filename)) cleanup.push(`/api/attachments/${a.id}`)
  }
})

test('PDF-Viewer: Inhaltsverzeichnis, Miniaturen, Seitenzahlen wie im Skript und „Zurück“ nach internem Link', async ({ page }) => {
  await login(page)
  // Sechs Seiten Vorspann (i–vi), danach zählt das Skript ab 1; auf S. 1 verweist ein Link auf S. 7
  const pdf = makePdf(
    Array.from({ length: 14 }, (_, i) => [i < 6 ? `Vorspann ${i + 1}` : `Skriptseite ${i - 5}`]),
    {
      outline: [
        { title: 'Vorwort', page: 1 },
        { title: 'Kapitel 1', page: 7, open: true, items: [{ title: 'Abschnitt 1.1', page: 9 }] },
        { title: 'Kapitel 2', page: 12, items: [{ title: 'Abschnitt 2.1', page: 13 }] },
      ],
      labels: [
        { from: 1, style: 'r' },
        { from: 7, style: 'D' },
      ],
      links: [{ page: 7, rect: [60, 740, 400, 790], to: 13 }],
    },
  )
  const up = await page.request.post('/api/attachments', {
    headers: await apiHeaders(page),
    multipart: { file: { name: 'Skript Navigation.pdf', mimeType: 'application/pdf', buffer: pdf } },
  })
  expect(up.status()).toBe(201)
  cleanup.push(`/api/attachments/${(await up.json()).attachment.id}`)
  const note = await post(page, '/api/notes', { title: 'Navigation im Skript', content: '![[Skript Navigation.pdf]]\n' }, 'note')
  cleanup.push(`/api/notes/${note.id}?permanent=1`)

  await page.goto(`/?n=${note.id}`)
  await page.getByRole('radio', { name: 'Lesen' }).click()
  await page.locator('.markdown-body a.embed-pdf').click()
  const panel = page.getByTestId('pdf-panel')
  await expect(panel.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 15_000 })
  await panel.getByRole('button', { name: 'Vollbild' }).click()

  // Seitenzahlen wie im Skript: das Label, dahinter die Position in der Datei – eingeben lässt sich beides
  const pageInput = panel.getByLabel('Seite', { exact: true })
  const position = panel.getByTestId('pdf-page-count')
  await expect(pageInput).toHaveValue('i')
  await expect(position).toHaveText('(1 / 14)')
  await pageInput.fill('v')
  await pageInput.press('Enter')
  await expect(position).toHaveText('(5 / 14)')
  await expect(pageInput).toHaveValue('v')
  await pageInput.fill('1')
  await pageInput.press('Enter')
  await expect(position).toHaveText('(7 / 14)')

  // Interner Link und zurück an die Stelle davor
  const link = panel.locator('.page[data-page-number="7"] .annotationLayer a')
  await expect(link).toHaveCount(1)
  await link.click()
  await expect(position).toHaveText('(13 / 14)')
  const back = panel.getByRole('button', { name: 'Zurück zu S. 1' })
  await back.click()
  await expect(position).toHaveText('(7 / 14)')
  await expect(back).toHaveCount(0)

  // Inhaltsverzeichnis: Baum mit dem aktuellen Kapitel, ein Klick springt hin
  await panel.getByRole('button', { name: 'Inhalt und Seiten' }).click()
  const nav = panel.getByTestId('pdf-navigation')
  const outline = nav.getByTestId('pdf-outline')
  await expect(outline.getByRole('button', { name: 'Abschnitt 1.1, S. 3' })).toBeVisible()
  await expect(outline.getByRole('button', { name: 'Abschnitt 2.1, S. 7' })).toHaveCount(0)
  await expect(outline.locator('[aria-current="location"]')).toHaveText(/^Kapitel 1/)
  await outline.getByRole('button', { name: 'Kapitel 2, S. 6' }).click()
  await expect(position).toHaveText('(12 / 14)')
  await expect(outline.locator('[aria-current="location"]')).toHaveText(/^Kapitel 2/)

  // Miniaturen: die aktuelle Seite hervorgehoben, nur sichtbare gezeichnet, ein Klick springt hin
  await nav.getByRole('tab', { name: 'Seiten' }).click()
  const thumbnails = nav.getByTestId('pdf-thumbnails')
  await expect(thumbnails.locator('[aria-current="page"]')).toHaveAccessibleName('Seite 6')
  await thumbnails.getByRole('button', { name: 'Seite iii' }).click()
  await expect(position).toHaveText('(3 / 14)')
  await expect(thumbnails.locator('[aria-current="page"]')).toHaveAccessibleName('Seite iii')
  const drawn = () => thumbnails.locator('canvas').evaluateAll((list) => list.filter((c) => (c as HTMLCanvasElement).width > 0).length)
  await expect.poll(drawn).toBeGreaterThan(0)
  expect(await drawn()).toBeLessThan(14)
})

test('Notizen und Abschnitte einbetten: Inhalt im Lesemodus, Aufgaben bleiben in ihrer Notiz', async ({ page }) => {
  await login(page)
  const source = await post(
    page,
    '/api/notes',
    {
      title: 'Vorlesung 3 (Einbettung)',
      content: [
        '---',
        'quelle: Skript Analysis',
        '---',
        '# Vorlesung 3',
        'Einleitung zur Vorlesung',
        '',
        '## Grenzwert',
        'Eine Folge konvergiert gegen a, wenn …',
        '',
        '### Beispiel',
        '1/n → 0',
        '',
        '- [ ] Übung 4 rechnen',
        '',
        '## Stetigkeit',
        'Kommt im Lernzettel nicht vor',
      ].join('\n'),
    },
    'note',
  )
  const content = ['## Eigene Gliederung', '', '![[Vorlesung 3 (Einbettung)#Grenzwert]]', '', '- [ ] Eigene Aufgabe', ''].join('\n')
  const sheet = await post(page, '/api/notes', { title: 'Lernzettel (Einbettung)', content }, 'note')
  cleanup.push(`/api/notes/${sheet.id}?permanent=1`, `/api/notes/${source.id}?permanent=1`)

  await page.evaluate(() => localStorage.setItem('noted:mode', 'read'))
  await page.goto(`/?n=${sheet.id}`)
  const embed = page.getByTestId('note-embed')
  await expect(embed).toContainText('Eine Folge konvergiert gegen a')
  await expect(embed).toContainText('1/n → 0')
  for (const outside of ['Einleitung zur Vorlesung', 'Kommt im Lernzettel nicht vor', 'Skript Analysis']) {
    await expect(embed).not.toContainText(outside)
  }
  // Eingebettete Überschriften zählen nicht zur Gliederung dieser Notiz
  await expect(embed.locator('h2, h3')).toHaveCount(2)
  await expect(page.locator('.markdown-body h2[data-line], .markdown-body h3[data-line]')).toHaveCount(1)

  // Eine Aufgabe in der Einbettung lässt sich nicht abhaken – weder hier noch in der eigenen Notiz
  const foreign = embed.getByRole('checkbox')
  await foreign.click()
  await expect(foreign).not.toBeChecked()
  await page.waitForTimeout(1500)
  const stored = async (id: string) => (await (await page.request.get(`/api/notes/${id}`)).json()).note.content as string
  expect(await stored(sheet.id)).toBe(content)
  expect(await stored(source.id)).toContain('- [ ] Übung 4 rechnen')

  // Die Herkunft öffnet die eingebettete Notiz am Abschnitt
  await embed.getByRole('link', { name: 'Vorlesung 3 (Einbettung) › Grenzwert' }).click()
  await expect(page).toHaveURL(new RegExp(`n=${source.id}`))
  await expect(page.getByRole('heading', { name: 'Kommt im Lernzettel nicht vor' })).toHaveCount(0)
  await expect(page.locator('.markdown-body').first()).toContainText('Kommt im Lernzettel nicht vor')
})

test('Einbettungen: Zyklen und mehr als zwei Ebenen bleiben Link-Karten', async ({ page }) => {
  await login(page)
  const note = (title: string, content: string) => post(page, '/api/notes', { title, content }, 'note')
  const a = await note('Zyklus A', 'Text von A\n\n![[Zyklus B]]')
  const b = await note('Zyklus B', 'Text von B\n\n![[Zyklus A]]')
  const levels = [await note('Ebene 1', 'Text 1\n\n![[Ebene 2]]'), await note('Ebene 2', 'Text 2\n\n![[Ebene 3]]')]
  levels.push(await note('Ebene 3', 'Text 3\n\n![[Ebene 4]]'), await note('Ebene 4', 'Text 4'))
  for (const n of [a, b, ...levels]) cleanup.push(`/api/notes/${n.id}?permanent=1`)
  await page.evaluate(() => localStorage.setItem('noted:mode', 'read'))

  // A zeigt B, B zeigt A nur als Link-Karte
  await page.goto(`/?n=${a.id}`)
  const embeds = page.getByTestId('note-embed')
  await expect(embeds).toHaveCount(1)
  await expect(embeds).toContainText('Text von B')
  await expect(embeds.locator('a.embed-note')).toContainText('Zyklus A')

  // Zwei Ebenen tief, die dritte bleibt Link-Karte
  await page.goto(`/?n=${levels[0].id}`)
  await expect(embeds).toHaveCount(2)
  await expect(embeds.first()).toContainText('Text 3')
  await expect(page.locator('.markdown-body').first()).not.toContainText('Text 4')
  await expect(page.locator('a.embed-note', { hasText: 'Ebene 4' })).toHaveCount(1)
})

test('Notiz abfragen und nicht Gewusstes als Karteikarte übernehmen', async ({ page }) => {
  await login(page)
  const note = await post(
    page,
    '/api/notes',
    {
      title: 'Folgen und Reihen (Abfrage)',
      content: '# Folgen\n## Grenzwert\nEine Folge konvergiert gegen a, wenn …\n## Nullfolge\nEine Folge mit Grenzwert 0\n# Reihen\nSumme der Folgenglieder\n',
    },
    'note',
  )
  cleanup.push(`/api/notes/${note.id}?permanent=1`)

  await page.goto(`/?n=${note.id}`)
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click()
  await page.getByRole('menuitem', { name: 'Abfragen' }).click()
  const card = page.getByTestId('quiz-card')
  await expect(card).toContainText('Grenzwert')
  await expect(card).toContainText('Folgen')
  await expect(page.getByTestId('quiz-answer')).toHaveCount(0)
  await page.keyboard.press('Space')
  await expect(page.getByTestId('quiz-answer')).toContainText('konvergiert')
  await page.keyboard.press('Enter')

  await expect(card).toContainText('Nullfolge')
  await page.keyboard.press('Space')
  await page.keyboard.press('1')

  await expect(card).toContainText('Reihen')
  await page.getByTestId('quiz-reveal').click()
  await page.getByRole('button', { name: 'Gewusst', exact: true }).click()

  const done = page.getByTestId('quiz-done')
  await expect(done).toContainText('Gewusst: 2 von 3')
  await expect(page.getByTestId('quiz-missed')).toHaveText('Folgen › Nullfolge')
  await shot(page, '36-note-quiz')

  // Die nicht gewussten Abschnitte sind im Dialog vorausgewählt
  await done.getByRole('button', { name: 'Karteikarten daraus erstellen' }).click()
  const create = page.getByRole('dialog').getByTestId('create-from-note')
  await expect(create).toHaveText('1 Karte erstellen')
  await create.click()
  await expect(page.getByText('1 Karte erstellt.')).toBeVisible()
  const { cards } = await flashcards(page)
  const fromNote = cards.filter((c: { noteId: string }) => c.noteId === note.id)
  expect(fromNote.map((c: { front: string; back: string }) => [c.front, c.back])).toEqual([['Nullfolge', 'Eine Folge mit Grenzwert 0']])
  for (const c of fromNote) cleanup.push(`/api/cards/${c.id}`)

  // Ein nicht gewusster Abschnitt öffnet die Notiz an seiner Überschrift
  await page.getByTestId('quiz-missed').getByRole('button', { name: /Nullfolge/ }).click()
  await expect(page).toHaveURL(/&h=Nullfolge$/)
  await expect(page.getByTestId('note-title')).toHaveValue('Folgen und Reihen (Abfrage)')
})

test('Nach der Vorlesung an Karten erinnern, Fokus aus dem Termin starten', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-19T12:00:00+02:00') })
  await login(page)
  const event = (title: string, start: string, end: string) => ({
    title,
    location: '',
    notes: '',
    color: null,
    allDay: false,
    start,
    end,
    repeat: null,
    exdates: [],
    exam: null,
  })
  await post(page, '/api/calendar', event('Analysis I', '2026-10-19T10:15', '2026-10-19T11:45'), 'event')
  await post(page, '/api/calendar', event('Lernblock', '2026-10-19T12:30', '2026-10-19T14:00'), 'event')
  const note = await post(page, '/api/notes', { title: '2026-10-19 Analysis I', content: '## Grenzwert\nZahl, der sich die Folge nähert\n' }, 'note')
  cleanup.push(`/api/notes/${note.id}?permanent=1`)
  await page.reload()

  const hints = page.getByTestId('lecture-hints')
  await expect(hints).toContainText('Analysis I ist vorbei')
  await expect(hints).not.toContainText('Lernblock')
  await shot(page, '62-lecture-hint')
  await hints.getByRole('button', { name: 'Karten erstellen' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('„2026-10-19 Analysis I“')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  // Weggeklickt bleibt weggeklickt
  await hints.getByRole('button', { name: 'Hinweis ausblenden' }).click()
  await expect(hints).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('agenda')).toContainText('Lernblock')
  await expect(page.getByTestId('lecture-hints')).toHaveCount(0)

  // Fokus starten: Countdown mit der Dauer des Lernblocks
  await page.getByTestId('agenda').getByRole('button', { name: /Lernblock/ }).click()
  await expect(dialog).toContainText('Fokus-Timer als Countdown (90 min)')
  await dialog.getByRole('button', { name: 'Fokus starten' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('focus-mini')).toContainText(/Countdown\s*1:(30:00|29:\d\d)/)
})

test('Links auf Abschnitte springen zur Überschrift – im Lesemodus und im Editor', async ({ page }) => {
  await login(page)
  const filler = Array.from({ length: 80 }, (_, i) => `Absatz ${i + 1}`).join('\n\n')
  const target = await post(page, '/api/notes', { title: 'Lange Mitschrift', content: `# Anfang\n\n${filler}\n\n## Ziel\nHier steht es.\n` }, 'note')
  const source = await post(page, '/api/notes', { title: 'Verweise', content: 'Siehe [[Lange Mitschrift#Ziel]]\n' }, 'note')
  cleanup.push(`/api/notes/${target.id}?permanent=1`, `/api/notes/${source.id}?permanent=1`)

  await page.goto(`/?n=${source.id}`)
  await page.getByRole('radio', { name: 'Lesen' }).click()
  await page.locator('.markdown-body a', { hasText: 'Lange Mitschrift › Ziel' }).click()
  await expect(page).toHaveURL(new RegExp(`n=${target.id}&h=Ziel$`))
  await expect(page.locator('.markdown-body h2', { hasText: 'Ziel' })).toBeInViewport()

  // Im Editor steht der Cursor auf der Überschrift
  await page.getByRole('radio', { name: 'Bearbeiten' }).click()
  await page.goto(`/?n=${target.id}&h=Ziel`)
  await expect(page.locator('.cm-line', { hasText: '## Ziel' })).toBeInViewport()
})

test('Gliederung: Überschriften auflisten, hinspringen und den aktuellen Abschnitt hervorheben', async ({ page, browser }) => {
  await login(page)
  const filler = Array.from({ length: 80 }, (_, i) => `Absatz ${i + 1}`).join('\n\n')
  const content = `# Anfang\n\n${filler}\n\n\`\`\`\n# kein Titel\n\`\`\`\n\n## Ziel\nHier steht es.\n`
  const note = await post(page, '/api/notes', { title: 'Lange Gliederung', content }, 'note')
  cleanup.push(`/api/notes/${note.id}?permanent=1`)

  await page.evaluate(() => localStorage.setItem('noted:mode', 'edit'))
  await page.goto(`/?n=${note.id}`)
  const toggle = page.getByRole('button', { name: 'Gliederung', exact: true })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  const outline = page.getByRole('navigation', { name: 'Gliederung' })
  const entries = outline.locator('button[data-index]')
  await expect(entries).toHaveText(['Anfang', 'Ziel'])
  await expect(outline).not.toContainText('kein Titel')
  // Als Spalte links neben dem Blatt, nicht darüber
  const column = (await outline.boundingBox())!
  expect(column.x + column.width).toBeLessThanOrEqual((await page.locator('.note-paper').boundingBox())!.x)

  // Klick: Die Überschrift ist im Bild (oben, soweit das Textende es zulässt), der Editor bekommt keinen Fokus
  await outline.getByRole('button', { name: 'Ziel' }).click()
  const target = page.locator('.cm-line', { hasText: '## Ziel' })
  await expect(target).toBeInViewport()
  await expect(outline.getByRole('button', { name: 'Ziel' })).toHaveAttribute('aria-current', 'location')
  await expect(outline.getByRole('button', { name: 'Ziel' })).toBeFocused()
  await expect(page.locator('.cm-content')).not.toBeFocused()
  // Per Tastatur wandert der Fokus in den Editor
  await page.keyboard.press('Home')
  await expect(outline.getByRole('button', { name: 'Anfang' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('.cm-content')).toBeFocused()
  await shot(page, '57-outline')

  // Die Spalte bleibt nach dem Neuladen
  await page.reload()
  await expect(outline).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')

  // Lesemodus: Auswahl per Tastatur setzt den Fokus auf die Überschrift
  await page.getByRole('radio', { name: 'Lesen' }).click()
  await outline.getByRole('button', { name: 'Anfang' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.markdown-body h1', { hasText: 'Anfang' })).toBeFocused()
  await expect(outline.getByRole('button', { name: 'Anfang' })).toHaveAttribute('aria-current', 'location')
  // Beim Scrollen ist genau ein Abschnitt hervorgehoben – ganz unten der letzte, ganz oben der erste
  await page.locator('.note-paper').hover()
  await page.mouse.wheel(0, 50_000)
  await expect(outline.getByRole('button', { name: 'Ziel' })).toHaveAttribute('aria-current', 'location')
  await expect(outline.locator('[aria-current]')).toHaveCount(1)
  await page.mouse.wheel(0, -50_000)
  await expect(outline.getByRole('button', { name: 'Anfang' })).toHaveAttribute('aria-current', 'location')

  // Zu schmal für die Spalte (wie mit PDF daneben): Der Knopf öffnet das Overlay, danach ist die Spalte wieder da
  await page.setViewportSize({ width: 1100, height: 720 })
  await expect(outline).toBeHidden()
  await toggle.click()
  await expect(outline).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(outline).toBeHidden()
  await page.setViewportSize({ width: 1280, height: 720 })
  await expect(outline).toBeVisible()

  // Handy: Die Liste klappt über dem Blatt auf, eine Auswahl springt und schließt sie
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const phone = await context.newPage()
  phone.on('pageerror', (err) => consoleErrors.push(String(err)))
  await login(phone)
  await phone.evaluate(() => localStorage.setItem('noted:mode', 'edit'))
  await phone.goto(`/?n=${note.id}`)
  const phoneToggle = phone.getByRole('button', { name: 'Gliederung', exact: true })
  const overlay = phone.getByRole('navigation', { name: 'Gliederung' })
  await phoneToggle.click()
  await expect(overlay).toBeVisible()
  await phone.keyboard.press('Escape')
  await expect(overlay).toBeHidden()
  await expect(phoneToggle).toBeFocused()
  await phoneToggle.click()
  await overlay.getByRole('button', { name: 'Ziel' }).click()
  await expect(overlay).toBeHidden()
  await expect(phone.locator('.cm-line', { hasText: '## Ziel' })).toBeInViewport()
  await expect(phone.locator('.cm-content')).not.toBeFocused()
  await context.close()
})

test('Abschnitte einklappen: Knopf vor der Überschrift, Kontextmenü, Tastatur und Gliederung', async ({ page }) => {
  await login(page)
  const content = '# Kapitel 1\nText eins\n\n# Kapitel 2\nText zwei\n\n## Unterkapitel 2.1\nText zwei-eins\n\n# Kapitel 3\nText drei\n'
  const note = await post(page, '/api/notes', { title: 'Einklappen', content }, 'note')
  cleanup.push(`/api/notes/${note.id}?permanent=1`)
  await page.evaluate(() => localStorage.setItem('noted:mode', 'edit'))
  await page.goto(`/?n=${note.id}`)
  const editor = page.locator('.note-paper .cm-content')
  const line = (text: string) => page.locator('.cm-line', { hasText: text })
  await expect(line('Text zwei-eins')).toBeVisible()

  // Knopf vor „Kapitel 2“: blendet bis zur nächsten Überschrift gleicher Ebene aus, Kapitel 3 bleibt
  await line('# Kapitel 2').hover()
  await line('# Kapitel 2').getByRole('button', { name: 'Abschnitt einklappen' }).click()
  await expect(editor).not.toContainText('Text zwei')
  await expect(line('Text drei')).toBeVisible()
  await expect(line('# Kapitel 2').getByRole('button', { name: 'Abschnitt aufklappen' })).toHaveAttribute('aria-expanded', 'false')
  await shot(page, '58-folding')
  // „…“ klappt wieder auf
  await page.locator('.cm-foldPlaceholder').click()
  await expect(line('Text zwei-eins')).toBeVisible()

  // Kontextmenü: alle einklappen, dann springt die Gliederung in einen eingeklappten Abschnitt und klappt ihn auf
  await line('Text eins').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Alle Abschnitte einklappen' }).click()
  await expect(editor).not.toContainText('Text eins')
  await expect(editor).not.toContainText('Text drei')
  await page.getByRole('button', { name: 'Gliederung', exact: true }).click()
  await page.getByRole('navigation', { name: 'Gliederung' }).getByRole('button', { name: 'Unterkapitel 2.1' }).click()
  await expect(line('## Unterkapitel 2.1')).toBeVisible()
  await expect(line('Text zwei-eins')).toBeVisible()

  // Tastatur: Strg+Alt+] klappt alles auf, Strg+Umschalt+[ den Abschnitt am Cursor ein
  await line('Text zwei-eins').click()
  await page.keyboard.press('Control+Alt+BracketRight')
  await expect(line('Text drei')).toBeVisible()
  await expect(line('Text eins')).toBeVisible()
  await line('Text drei').click()
  await page.keyboard.press('Control+Shift+BracketLeft')
  await expect(editor).not.toContainText('Text drei')

  // Einklappen ändert den Inhalt nicht
  const saved = (await (await page.request.get(`/api/notes/${note.id}`)).json()).note
  expect(saved.content).toBe(content)

  // Tippen in der Zeile einer eingeklappten Überschrift klappt sie auf
  await line('# Kapitel 3').click()
  await page.keyboard.press('End')
  await page.keyboard.type('!')
  await expect(line('Text drei')).toBeVisible()
})

test('Suche: Klick auf einen Treffer springt zur Fundstelle – im Editor und im Lesemodus', async ({ page }) => {
  await login(page)
  const filler = Array.from({ length: 80 }, (_, i) => `Absatz ${i + 1}`).join('\n\n')
  const content = `# Analysis\n\n${filler}\n\nDie **Taylorreihe** nähert eine Funktion an.\n\nÜbungen dazu folgen.\n`
  const note = await post(page, '/api/notes', { title: 'Lange Mitschrift Reihen', content }, 'note')
  cleanup.push(`/api/notes/${note.id}?permanent=1`)
  const highlighted = () =>
    page.evaluate(() => ({ all: CSS.highlights.get('search-hit')?.size ?? 0, current: CSS.highlights.get('search-current')?.size ?? 0 }))

  // Editor: Die Zeile mit dem Treffer ist im Bild und markiert
  await page.evaluate(() => localStorage.setItem('noted:mode', 'edit'))
  await page.goto('/?q=taylor')
  await page.getByRole('main').getByRole('link', { name: /Lange Mitschrift Reihen/ }).click()
  await expect(page).toHaveURL(/find=taylor/)
  const hit = page.locator('.cm-search-hit')
  await expect(hit).toHaveText('Taylor')
  await expect(hit).toBeInViewport()
  const bar = page.getByTestId('find-bar')
  await expect(bar).toContainText('1 Treffer für „taylor“')
  await shot(page, '59-find-editor')
  // Tippen entfernt die Markierung und die Leiste
  await page.locator('.cm-content').click()
  await page.keyboard.type('x')
  await expect(hit).toHaveCount(0)
  await expect(bar).toBeHidden()
  await expect(page).not.toHaveURL(/find=/)

  // Lesemodus: „ubung“ findet „Übungen“, mehrere Begriffe, Pfeile springen, Esc schließt
  await page.evaluate(() => localStorage.setItem('noted:mode', 'read'))
  await page.goto('/?q=ubung%20taylor')
  await page.getByRole('main').getByRole('link', { name: /Lange Mitschrift Reihen/ }).click()
  await expect(bar).toContainText('Treffer 1 von 2 für „ubung taylor“')
  await expect.poll(highlighted).toEqual({ all: 2, current: 1 })
  await expect(page.locator('.markdown-body strong', { hasText: 'Taylorreihe' })).toBeInViewport()
  await bar.getByRole('button', { name: 'Nächster Treffer' }).click()
  await expect(bar).toContainText('Treffer 2 von 2')
  await page.keyboard.press('Escape')
  await expect(bar).toBeHidden()
  await expect.poll(highlighted).toEqual({ all: 0, current: 0 })

  // Nur im Titel gefunden: Die Notiz öffnet oben, ohne Leiste
  await page.goto('/?q=mitschrift')
  await page.getByRole('main').getByRole('link', { name: /Lange Mitschrift Reihen/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Lange Mitschrift Reihen' })).toBeVisible()
  await expect(bar).toBeHidden()
})

test('Glossar und Formeln eines Ordners: durchsuchen und an die Stelle springen', async ({ page }) => {
  await login(page)
  const folder = await post(page, '/api/folders', { name: 'Glossar-Test', parentId: null }, 'folder')
  const inside = await post(
    page,
    '/api/notes',
    {
      title: 'Analysis Glossar',
      folderId: folder.id,
      content: '# Folgen\n> [!info] Grenzwert\n> Zahl, der sich die Folge nähert\n\n**Nullfolge**: Folge mit Grenzwert 0\n\n## Reihen\n$$\n\\sum_{k=1}^\\infty a_k\n$$\n',
    },
    'note',
  )
  const outside = await post(page, '/api/notes', { title: 'Außerhalb', content: '**Außen**: nicht im Ordner\n' }, 'note')
  cleanup.push(`/api/notes/${inside.id}?permanent=1`, `/api/notes/${outside.id}?permanent=1`, `/api/folders/${folder.id}`)

  await page.goto(`/?f=${folder.id}`)
  await page.getByRole('main').getByRole('button', { name: 'Ordner-Aktionen' }).click()
  await page.getByRole('menuitem', { name: 'Glossar und Formeln' }).click()
  const terms = page.getByTestId('glossary-terms')
  await expect(terms).toContainText('Grenzwert')
  await expect(terms).toContainText('Zahl, der sich die Folge nähert')
  await expect(terms).toContainText('Nullfolge')
  await expect(terms).not.toContainText('Außen')
  await page.getByLabel('Glossar durchsuchen').fill('null')
  await expect(terms).toContainText('Nullfolge')
  await expect(terms).not.toContainText('Zahl, der sich die Folge nähert')
  await page.getByLabel('Glossar durchsuchen').fill('')

  await page.getByRole('tab', { name: /Formeln/ }).click()
  const formulas = page.getByTestId('glossary-formulas')
  await expect(formulas.locator('.katex-display')).toHaveCount(1)
  await shot(page, '37-glossary')
  await formulas.getByRole('button', { name: 'Reihen' }).click()
  await expect(page).toHaveURL(new RegExp(`n=${inside.id}&h=Reihen$`))
})

test('Lernstatistik: Bewertungen werden protokolliert und ausgewertet', async ({ page }) => {
  await login(page)
  const deck = await post(page, '/api/decks', { name: 'Statistik-Stapel' }, 'deck')
  cleanup.push(`/api/decks/${deck.id}`)
  const [one, two] = await post<Created[]>(
    page,
    `/api/decks/${deck.id}/cards`,
    { cards: [{ type: 'basic', front: 'Eins', back: '1' }, { type: 'basic', front: 'Zwei', back: '2' }] },
    'cards',
  )
  // Gestern und vorgestern gelernt – so, wie es ein anderes Gerät nachträglich sendet
  const now = Date.now()
  const entry = (cardId: string, daysAgo: number, rating: number) => ({
    cardId,
    side: 0,
    rating,
    phase: 'review',
    intervalBefore: 1,
    intervalAfter: 2,
    durationMs: 5000,
    reviewedAt: now - daysAgo * DAY,
  })
  await post(page, '/api/reviews', { reviews: [], log: [entry(one.id, 1, 3), entry(two.id, 1, 1), entry(one.id, 2, 3)] }, 'logged')

  // Heute eine Karte im Lernmodus – landet im Protokoll
  await page.goto(`/?s=deck:${deck.id}`)
  await expect(page.getByTestId('study-card')).toContainText('Eins')
  await page.keyboard.press('Space')
  await page.getByTestId('rate-4').click()
  await expect
    .poll(async () => {
      const s = await page.evaluate(() => fetch('/api/stats?tz=Europe/Berlin').then((r) => r.json()))
      return s.decks.find((d: { deckId: string }) => d.deckId === deck.id)?.reviews
    })
    .toBe(4)

  await page.goto('/?v=cards')
  await page.getByRole('button', { name: 'Lernstatistik' }).click()
  await expect(page.getByTestId('stats-figures')).toContainText('3 Tage')
  await expect(page.getByTestId('stats-heatmap').getByRole('img', { name: /: 2 Bewertungen, 1× Nochmal$/ })).toHaveCount(1)
  const row = page.getByTestId('stats-decks').locator('tr', { hasText: 'Statistik-Stapel' })
  await expect(row).toContainText('4')
  await expect(row).toContainText('67 %')
  const forecast = page.getByTestId('stats-forecast')
  await expect(forecast.getByRole('listitem')).toHaveCount(7)
  await shot(page, '38-stats')
  await forecast.getByRole('radio', { name: '30 Tage' }).click()
  await expect(forecast.getByRole('listitem')).toHaveCount(30)
})

test('Fokus-Runden mit Fach zählen und in der Lernstatistik sehen', async ({ page }) => {
  await page.clock.install()
  await login(page)
  const bar = page.getByTestId('global-toolbar')
  await bar.getByRole('button', { name: 'Werkzeuge' }).click()
  await bar.getByRole('button', { name: 'Fokus-Timer' }).click()
  const win = page.getByTestId('window-focus')
  await win.getByRole('radio', { name: 'Countdown' }).click()
  await win.getByRole('button', { name: '5 min', exact: true }).click()
  await win.getByLabel('Fach').fill('Analysis I')
  await win.getByLabel('Ziel').fill('Kapitel 3')
  await win.getByRole('button', { name: 'Start' }).click()
  await page.clock.fastForward('05:01')

  // Die Runde ist offen, bis sie bestätigt ist – in der Meldung oder im Fenster
  const pending = win.getByTestId('focus-pending')
  await expect(pending).toContainText('5 min · Analysis I – Kapitel 3')
  await shot(page, '53-focus-pending')
  await page.getByRole('status').getByRole('button', { name: 'Zählen' }).click()
  await expect(pending).toHaveCount(0)

  await page.goto('/?v=stats')
  const focus = page.getByTestId('stats-focus')
  await expect(focus).toContainText('Analysis I')
  await expect(focus).toContainText('Diese Woche: 5 min')
})

test('Lückentext: im Editor markieren und Lücke für Lücke lernen', async ({ page }) => {
  await login(page)
  const deck = await post(page, '/api/decks', { name: 'Lücken' }, 'deck')
  cleanup.push(`/api/decks/${deck.id}`)
  await page.goto(`/?d=${deck.id}`)
  await page.getByTestId('add-card').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('radio', { name: 'Lückentext' }).click()
  const front = dialog.getByTestId('card-front')
  await front.fill('Die Ableitung von sin ist cos.')
  await front.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(18, 21))
  await dialog.getByRole('button', { name: 'Als Lücke' }).click()
  await expect(front).toHaveValue('Die Ableitung von ==sin== ist cos.')
  // Der Editor setzt den Cursor im nächsten Frame hinter die Lücke – erst danach ersetzen, sonst landet der neue Text
  // mitten im alten
  await expect.poll(() => front.evaluate((el: HTMLTextAreaElement) => el.selectionStart)).toBe(25)
  await front.fill('Die Ableitung von ==sin== ist {{cos}}.')
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click()
  await expect(page.getByTestId('card-list')).toContainText('Lückentext')

  // Die erste Lücke ist verdeckt, die zweite steht da; Aufdecken füllt die Lücke im Satz
  await page.getByTestId('deck-learn').click()
  const card = page.getByTestId('study-card')
  await expect(card.locator('.cloze-gap')).toHaveCount(1)
  await expect(card).toContainText('ist cos.')
  await expect(card).not.toContainText('von sin')
  await shot(page, '39-cloze')
  await page.keyboard.press('Space')
  await expect(card.locator('mark')).toHaveText('sin')
  await page.getByTestId('rate-4').click()
  // Die zweite Lücke kommt als neue Karte erst morgen
  await expect(page.getByTestId('study-done')).toBeVisible()
})

/** Kleines Anki-Paket im älteren Format: eine beidseitige Karte und ein Lückentext */
function ankiPackage(deck: string): Buffer {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE col (id INTEGER PRIMARY KEY, crt INTEGER, decks TEXT);
    CREATE TABLE notes (id INTEGER PRIMARY KEY, flds TEXT);
    CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER, ord INTEGER, type INTEGER, queue INTEGER,
      due INTEGER, ivl INTEGER, factor INTEGER, reps INTEGER, lapses INTEGER);
    CREATE TABLE revlog (id INTEGER PRIMARY KEY, cid INTEGER, ease INTEGER, ivl INTEGER, lastIvl INTEGER, time INTEGER, type INTEGER);
  `)
  db.prepare('INSERT INTO col VALUES (1, 1700000000, ?)').run(JSON.stringify({ 5: { id: 5, name: deck } }))
  db.exec(`
    INSERT INTO notes VALUES (1, 'apple' || char(31) || 'Apfel'), (2, '{{c1::Berlin}} ist die Hauptstadt' || char(31) || '');
    INSERT INTO cards VALUES (11, 1, 5, 0, 0, 0, 0, 0, 0, 0, 0), (12, 1, 5, 1, 0, 0, 0, 0, 0, 0, 0), (21, 2, 5, 0, 0, 0, 0, 0, 0, 0, 0);
  `)
  const collection = db.serialize()
  db.close()
  return Buffer.from(zipSync({ 'collection.anki2': collection, media: strToU8('{}') }))
}

test('Anki-Deck importieren', async ({ page }) => {
  await login(page)
  await page.goto('/?v=cards')
  await page.getByRole('main').getByRole('button', { name: 'Weitere Aktionen' }).click()
  await page.getByRole('menuitem', { name: 'Anki-Deck importieren …' }).click()
  await page.getByTestId('anki-file').setInputFiles({ name: 'Vokabeln.apkg', mimeType: 'application/octet-stream', buffer: ankiPackage('Englisch::Vokabeln') })
  await page.getByTestId('anki-import').click()
  await expect(page.getByTestId('anki-result')).toContainText('2 Karten importiert, 1 neuer Stapel')
  await shot(page, '40-anki-import')
  await page.getByRole('button', { name: 'Fertig' }).click()
  const tile = page.getByTestId('deck-list').locator('> div').filter({ hasText: 'Englisch – Vokabeln' })
  await expect(tile).toContainText('2 fällig')
  const data = await flashcards(page)
  const deck = data.decks.find((d: { name: string }) => d.name === 'Englisch – Vokabeln')
  cleanup.push(`/api/decks/${deck.id}`)
  expect(data.cards.filter((c: { deckId: string }) => c.deckId === deck.id).map((c: { type: string }) => c.type)).toEqual(['reversed', 'cloze'])
})

test('Stapel als Datei exportieren und wieder importieren', async ({ page }) => {
  await login(page)
  const deck = await post(page, '/api/decks', { name: 'Pharmakologie', description: 'Wirkstoffe' }, 'deck')
  cleanup.push(`/api/decks/${deck.id}`)
  await page.request.post(`/api/decks/${deck.id}/cards`, {
    headers: await apiHeaders(page),
    data: { cards: [{ type: 'basic', front: 'Ibuprofen', back: 'NSAR' }, { type: 'cloze', front: '==Paracetamol== senkt Fieber' }] },
  })

  // Export über das Stapel-Menü
  await page.goto(`/?d=${deck.id}`)
  await page.getByRole('button', { name: 'Stapel-Aktionen' }).click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Als Datei exportieren' }).click()])
  expect(download.suggestedFilename()).toBe('Pharmakologie.noted-deck.zip')
  const file = await download.path()

  // Import in der Übersicht – als neuer Stapel mit freiem Namen
  await page.goto('/?v=cards')
  await page.getByRole('main').getByRole('button', { name: 'Weitere Aktionen' }).click()
  await page.getByRole('menuitem', { name: 'Stapel importieren …' }).click()
  await page.getByTestId('deck-file').setInputFiles(file)
  await page.getByTestId('deck-import').click()
  await expect(page.getByTestId('deck-import-result')).toContainText('2 Karten in den neuen Stapel „Pharmakologie 1“ importiert')
  await shot(page, '41-deck-import')
  await page.getByRole('button', { name: 'Stapel öffnen' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pharmakologie 1')
  const data = await flashcards(page)
  const copy = data.decks.find((d: { name: string }) => d.name === 'Pharmakologie 1')
  cleanup.push(`/api/decks/${copy.id}`)
  expect(copy.description).toBe('Wirkstoffe')
  expect(data.cards.filter((c: { deckId: string }) => c.deckId === copy.id).map((c: { front: string }) => c.front)).toEqual([
    'Ibuprofen',
    '==Paracetamol== senkt Fieber',
  ])
})

test('Wiederholungsplan FSRS je Stapel', async ({ page }) => {
  await login(page)
  const deck = await post(page, '/api/decks', { name: 'FSRS-Stapel' }, 'deck')
  cleanup.push(`/api/decks/${deck.id}`)
  await post(page, `/api/decks/${deck.id}/cards`, { cards: [{ type: 'basic', front: 'Frage', back: 'Antwort' }] }, 'cards')
  await page.goto(`/?d=${deck.id}`)
  await page.getByRole('button', { name: 'Stapel-Aktionen' }).click()
  await page.getByRole('menuitem', { name: 'Stapel bearbeiten …' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Wiederholungsplan').selectOption('fsrs')
  await expect(dialog.getByLabel('Gewünschte Behaltensrate (%)')).toHaveValue('90')
  await dialog.getByRole('button', { name: 'Speichern' }).click()
  await expect(dialog).toBeHidden()

  // Neue Karte: „Einfach“ plant mit FSRS nach der Anfangsstabilität (gut zwei Wochen) statt 4 Tage wie mit SM-2
  await page.getByTestId('deck-learn').click()
  // Erst tippen, wenn die Karte da ist – sonst geht die Leertaste je nach Auslastung ins Leere
  await expect(page.getByTestId('study-card')).toContainText('Frage')
  await page.keyboard.press('Space')
  // Gut zwei Wochen (16 Tage), je Karte leicht gestreut: 13–19 Tage
  await expect(page.getByTestId('rate-4')).toContainText(/(?<!\d)1[3-9] Tage/)
  await expect(page.getByTestId('rate-3')).toContainText('10 Min.')
})

test('Klausurmodus: Klausur im Kalender, Countdown und Wiederholungen davor', async ({ page }) => {
  await login(page)
  const deck = await post(page, '/api/decks', { name: 'Analysis I', newPerDay: 1 }, 'deck')
  cleanup.push(`/api/decks/${deck.id}`)
  const cards = await post<Created[]>(
    page,
    `/api/decks/${deck.id}/cards`,
    { cards: ['a', 'b', 'c', 'd', 'e'].map((x) => ({ type: 'basic', front: `Frage ${x}`, back: `Antwort ${x}` })) },
    'cards',
  )
  // Drei Karten sind gelernt und kämen erst in einem Monat wieder dran
  const now = Date.now()
  const learned = { phase: 'review', step: 0, interval: 40, ease: 2.5, reps: 5, lapses: 0, due: now + 30 * DAY, reviewedAt: now - 10 * DAY, introducedAt: now - 60 * DAY }
  await post(page, '/api/reviews', { reviews: cards.slice(0, 3).map((c) => ({ cardId: c.id, side: 0, ...learned })) }, 'saved')

  await page.goto('/')
  const exams = page.getByTestId('exams')
  await expect(page.getByTestId('agenda')).toBeVisible()
  await expect(exams).toHaveCount(0)

  // Klausur morgen – der gleichnamige Stapel ist vorausgewählt, wiederholen kann sie sich nicht
  const tomorrow = await page.evaluate(() => {
    const d = new Date(Date.now() + 86_400_000)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  await page.getByTestId('agenda').getByRole('button', { name: 'Termin anlegen' }).click()
  const add = page.getByRole('dialog')
  await add.getByLabel('Titel').fill('Analysis I')
  await add.getByLabel('Beginn').fill(tomorrow)
  await add.getByRole('switch', { name: 'Klausur' }).click()
  await expect(add.getByRole('checkbox', { name: 'Analysis I' })).toBeChecked()
  await expect(add.getByLabel('Wiederholung')).toHaveCount(0)
  await shot(page, '46-exam-dialog')
  await add.getByRole('button', { name: 'Speichern' }).click()
  await expect(add).toBeHidden()

  // Startseite: Countdown mit Lernstand; die Wiederholungen sind vorgezogen
  await expect(exams.getByTestId('exam')).toContainText('morgen')
  await expect(exams).toContainText('60 % gelernt · 2 neu · heute 4 fällig')
  await expect(page.getByTestId('agenda').getByRole('img', { name: 'Klausur' })).toBeVisible()
  await shot(page, '47-exam-countdown')

  // Stapel: Vorschlag, wie viele neue Karten es pro Tag braucht
  await page.goto(`/?d=${deck.id}`)
  const plan = page.getByTestId('exam-plan')
  await expect(plan).toContainText('sind 2 pro Tag nötig (Tageslimit: 1)')
  await shot(page, '48-exam-plan')
  await plan.getByRole('button', { name: '2 pro Tag übernehmen' }).click()
  await expect(plan).toContainText('Mit 2 neuen Karten pro Tag lernst du alle 2 neuen rechtzeitig.')

  // Für die Klausur lernen: alles kommt einmal dran, danach ist bis zur Klausur nichts mehr fällig
  await page.goto('/')
  await exams.getByRole('button', { name: 'Lernen' }).click()
  for (let i = 0; i < 5; i++) {
    await expect(page.getByTestId('study-card')).toBeVisible()
    await page.keyboard.press('Space')
    await page.getByTestId('rate-4').click()
  }
  await expect(page.getByTestId('study-done')).toBeVisible()
  await page.getByRole('button', { name: 'Fertig' }).click()
  await expect(exams).toContainText('100 % gelernt')
  await expect(exams).not.toContainText('fällig')
  await expect(exams.getByRole('button', { name: 'Lernen' })).toHaveCount(0)
})

test('Bildverdeckung: Flächen über ein Bild ziehen und einzeln lernen', async ({ page }) => {
  await login(page)
  const deck = await post(page, '/api/decks', { name: 'Anatomie' }, 'deck')
  cleanup.push(`/api/decks/${deck.id}`)
  // Ein Bild mit zwei Beschriftungen (im Browser gezeichnet) und ein PDF mit einer Abbildung auf Seite 2
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 400
    canvas.height = 240
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, 400, 240)
    ctx.fillStyle = '#c00'
    ctx.beginPath()
    ctx.arc(200, 130, 70, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#000'
    ctx.font = '20px sans-serif'
    ctx.fillText('Aorta', 30, 40)
    ctx.fillText('Vene', 300, 220)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  const headers = await apiHeaders(page)
  const up = await page.request.post('/api/attachments', {
    headers,
    multipart: { file: { name: 'Abbildungen.pdf', mimeType: 'application/pdf', buffer: makePdf([['Titel'], ['Abbildung 2', 'Schema']]) } },
  })
  expect(up.status()).toBe(201)

  await page.goto(`/?d=${deck.id}`)
  await page.getByTestId('add-card').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('radio', { name: 'Bildverdeckung' }).click()
  await dialog.getByTestId('occlusion-upload').setInputFiles({ name: 'herz.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  const editor = dialog.getByTestId('occlusion-editor')
  await expect(editor.locator('img')).toBeVisible()
  await expect(dialog.getByTestId('card-front')).toHaveValue('herz')

  // Zwei Flächen ziehen, die erste beschriften
  const drag = async (x1: number, y1: number, x2: number, y2: number) => {
    await editor.scrollIntoViewIfNeeded()
    const box = (await editor.boundingBox())!
    await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * ((x1 + x2) / 2), box.y + box.height * ((y1 + y2) / 2))
    await page.mouse.move(box.x + box.width * x2, box.y + box.height * y2)
    await page.mouse.up()
  }
  await drag(0.05, 0.05, 0.3, 0.22)
  await drag(0.72, 0.8, 0.95, 0.97)
  await expect(editor.locator('[data-mask]')).toHaveCount(2)
  await dialog.getByLabel('Beschriftung von Fläche 1').fill('Aorta')
  await shot(page, '52-occlusion-editor')
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click()
  await expect(dialog).toBeHidden()
  // Die Flächen liegen dort, wo gezogen wurde – relativ zum Bild
  const saved = (await flashcards(page)).cards.find((c: { deckId: string }) => c.deckId === deck.id)
  const near = (n: number) => expect.closeTo(n, 0)
  expect(saved.occlusion.masks.map((m: Record<string, number>) => [m.x, m.y, m.w, m.h].map((v) => v * 100))).toEqual([
    [near(5), near(5), near(25), near(17)],
    [near(72), near(80), near(23), near(17)],
  ])

  const item = page.getByTestId('card-list').locator('> li').first()
  await expect(item).toContainText('Bildverdeckung')
  await expect(item).toContainText('Aorta · Fläche 2')

  // Lernen: Die erste Fläche ist verdeckt, beim Aufdecken erscheint ihre Beschriftung
  await page.getByTestId('deck-learn').click()
  const card = page.getByTestId('study-card')
  await expect(card.getByTestId('occlusion-asked')).toBeVisible()
  await expect(card).toContainText('herz')
  await shot(page, '53-occlusion-study')
  await page.keyboard.press('Space')
  await expect(card.getByTestId('occlusion-revealed')).toBeVisible()
  await expect(page.getByTestId('study-answer')).toContainText('Aorta')
  await page.getByTestId('rate-4').click()
  await expect(page.getByTestId('study-done')).toBeVisible()
  // Neue Flächen kommen nacheinander an verschiedenen Tagen dran – heute nur die erste
  await expect
    .poll(async () => {
      const data = await flashcards(page)
      const id = data.cards.find((c: { deckId: string }) => c.deckId === deck.id).id
      return data.reviews.filter((r: { cardId: string }) => r.cardId === id).map((r: { side: number }) => r.side)
    })
    .toEqual([0])

  // Die gelernte erste Fläche fällt weg: Ihr Lernstand geht mit, die zweite bleibt neu
  const [aorta, vene] = saved.occlusion.masks as { id: string }[]
  expect(aorta.id).toBeTruthy()
  expect(vene.id).not.toBe(aorta.id)
  await page.goto(`/?d=${deck.id}`)
  await item.getByRole('button', { name: 'Karte bearbeiten' }).click()
  await dialog.getByRole('button', { name: 'Fläche 1 entfernen' }).click()
  await expect(dialog.getByTestId('occlusion-editor').locator('[data-mask]')).toHaveCount(1)
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click()
  await expect(dialog).toBeHidden()
  const edited = (await flashcards(page)).cards.find((c: { id: string }) => c.id === saved.id)
  expect(edited.occlusion.masks.map((m: { id: string }) => m.id)).toEqual([vene.id])
  expect((await flashcards(page)).reviews.filter((r: { cardId: string }) => r.cardId === saved.id)).toEqual([])

  // Eine PDF-Seite als Bild übernehmen
  await page.goto(`/?d=${deck.id}`)
  await page.getByTestId('add-card').click()
  await dialog.getByRole('radio', { name: 'Bildverdeckung' }).click()
  await dialog.getByLabel('PDF', { exact: true }).selectOption('Abbildungen.pdf')
  await dialog.getByLabel('Seite').fill('2')
  await dialog.getByRole('button', { name: 'Seite übernehmen' }).click()
  await expect(dialog.getByTestId('occlusion-editor').locator('img')).toBeVisible({ timeout: 15_000 })
  await expect(dialog.getByTestId('card-front')).toHaveValue('Abbildungen S. 2')
  await page.keyboard.press('Escape')

  const { attachments } = await (await page.request.get('/api/attachments')).json()
  for (const a of attachments as { id: string; filename: string }[]) {
    if (['herz.png', 'Abbildungen.pdf', 'Abbildungen S. 2.png'].includes(a.filename)) cleanup.push(`/api/attachments/${a.id}`)
  }
})

test('Volltextsuche in Dateien: Treffer im PDF öffnet den Viewer auf der Seite', async ({ page }) => {
  await login(page)
  const headers = await apiHeaders(page)
  const pdf = makePdf([['Optik'], ['Reflexion'], ['Totalreflexion', 'Lichtwellenleiter aus Glas']])
  const up = await page.request.post('/api/attachments', {
    headers,
    multipart: { file: { name: 'Skript Optik.pdf', mimeType: 'application/pdf', buffer: pdf } },
  })
  expect(up.status()).toBe(201)
  const att = (await up.json()).attachment as { id: string }
  cleanup.push(`/api/attachments/${att.id}`)
  // Der Text wird nach dem Upload im Hintergrund gelesen
  const found = async () => (await (await page.request.get('/api/search?q=lichtwellen')).json()).files.length
  await expect.poll(found).toBe(1)

  await page.goto('/?q=lichtwellen')
  const hits = page.getByTestId('search-files')
  await expect(hits.getByRole('heading', { name: 'In Dateien' })).toBeVisible()
  const hit = hits.getByRole('button', { name: /Skript Optik\.pdf/ })
  await expect(hit).toContainText('Seite 3')
  await expect(hit.locator('mark')).toHaveText('Lichtwellenleiter')
  await shot(page, '54-search-files')
  await hit.click()
  const panel = page.getByTestId('pdf-panel')
  await expect(panel.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 15_000 })
  await expect(panel.getByLabel('Seite', { exact: true })).toHaveValue('3')
  // Der Suchbegriff kommt mit: Suchleiste offen, Treffer auf der Seite hervorgehoben
  await expect(panel.getByPlaceholder('Im PDF suchen …')).toHaveValue('lichtwellen')
  await expect(panel.locator('.page[data-page-number="3"] .textLayer .highlight').first()).toBeVisible()
  await expect(panel.getByRole('status')).toHaveText('1 / 1')
  await expect(panel.getByLabel('Seite', { exact: true })).toHaveValue('3')

  // Im Bereich „Dateien“ steht, dass die Datei durchsuchbar ist
  await page.goto('/?v=files&in=unlinked')
  const card = page.getByTestId('file-card').filter({ hasText: 'Skript Optik.pdf' })
  await expect(card.getByTestId('file-search-state')).toHaveText('durchsuchbar')
  await card.getByRole('button', { name: 'Erneut indizieren' }).click()
  await expect(page.getByText('„Skript Optik.pdf“ ist durchsuchbar.')).toBeVisible()
})

test('PDF mit Markierungen herunterladen: echte Anmerkungen mit Kommentar, Original unverändert', async ({ page }) => {
  await login(page)
  const headers = await apiHeaders(page)
  const pdf = makePdf([['Wärmelehre'], ['Zweiter Hauptsatz', 'Die Entropie nimmt nie ab']])
  const up = await page.request.post('/api/attachments', {
    headers,
    multipart: { file: { name: 'Skript Export.pdf', mimeType: 'application/pdf', buffer: pdf } },
  })
  const att = (await up.json()).attachment as { id: string }
  cleanup.push(`/api/attachments/${att.id}`)
  const now = Date.now()
  const saved = await page.request.put(`/api/attachments/${att.id}/annotations`, {
    headers,
    data: {
      annotations: [
        { id: crypto.randomUUID(), page: 2, rects: [[60, 730, 300, 752]], quote: 'Die Entropie nimmt nie ab', comment: 'Klausurrelevant', color: 4, createdAt: now, updatedAt: now },
      ],
    },
  })
  expect(saved.ok()).toBe(true)
  const note = await post(page, '/api/notes', { title: 'Export Mitschrift', content: 'Siehe [[Skript Export.pdf#page=2]]\n', folderId: null }, 'note')
  cleanup.push(`/api/notes/${note.id}?permanent=1`)

  await page.goto(`/?n=${note.id}`)
  await page.getByRole('radio', { name: 'Lesen' }).click()
  await page.locator('.markdown-body a.file-link-pdf').click()
  const panel = page.getByTestId('pdf-panel')
  await expect(panel.locator('.page[data-page-number="2"] .pdf-annotation')).toHaveCount(1, { timeout: 15_000 })
  await panel.getByRole('button', { name: 'Weitere PDF-Aktionen' }).click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Mit Markierungen herunterladen' }).click(),
  ])
  expect(download.suggestedFilename()).toBe('Skript Export (mit Markierungen).pdf')
  const file = await readFile((await download.path())!)
  expect(file.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  expect(file.toString('latin1')).toContain('/Highlight')
  expect(file.length).toBeGreaterThan(pdf.length)
  // Auf dem Server liegt weiter das Original
  const original = await page.request.get(`/api/attachments/${att.id}`)
  expect(Buffer.from(await original.body()).equals(pdf)).toBe(true)
})

test('PDF-Anmerkungen: Text markieren, nach Zoom und Neuladen wiederfinden und als Zitat einfügen', async ({ page }) => {
  await login(page)
  const headers = await apiHeaders(page)
  const pdf = makePdf([['Wärmelehre'], ['Zweiter Hauptsatz', 'Die Entropie nimmt nie ab', 'Ende der Seite']])
  const up = await page.request.post('/api/attachments', {
    headers,
    multipart: { file: { name: 'Skript Wärme.pdf', mimeType: 'application/pdf', buffer: pdf } },
  })
  expect(up.status()).toBe(201)
  const att = (await up.json()).attachment as { id: string }
  cleanup.push(`/api/attachments/${att.id}`)
  const note = await post(page, '/api/notes', { title: 'Entropie Mitschrift', content: 'Siehe [[Skript Wärme.pdf#page=2]]\n', folderId: null }, 'note')
  cleanup.push(`/api/notes/${note.id}?permanent=1`)
  const saved = async () =>
    (await (await page.request.get(`/api/attachments/${att.id}/annotations`)).json()).annotations as { comment: string; color: number }[]

  await page.goto(`/?n=${note.id}`)
  await page.getByRole('radio', { name: 'Lesen' }).click()
  await page.locator('.markdown-body a.file-link-pdf').click()
  const panel = page.getByTestId('pdf-panel')
  await expect(panel.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 15_000 })
  await expect(panel.getByLabel('Seite', { exact: true })).toHaveValue('2')

  // Text im Text-Layer mit der Maus auswählen und markieren
  const span = panel.locator('.page[data-page-number="2"] .textLayer span', { hasText: 'Die Entropie nimmt nie ab' })
  await expect(span).toHaveCount(1)
  const selectionBar = panel.getByTestId('pdf-selection')
  const markText = async () => {
    const b = (await span.boundingBox())!
    await page.mouse.move(b.x + 1, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width - 1, b.y + b.height / 2, { steps: 10 })
    await page.mouse.up()
    await expect(selectionBar).toContainText('Entropie')
    await selectionBar.getByRole('button', { name: 'Markieren' }).click()
  }
  let box = (await span.boundingBox())!
  await markText()
  const mark = panel.locator('.page[data-page-number="2"] .pdf-annotation')
  await expect(mark).toHaveCount(1)
  await expect.poll(async () => (await saved()).length).toBe(1)

  // Die Markierung liegt auf dem Text – auch nach dem Vergrößern
  const covers = async () => {
    const [t, m] = [(await span.boundingBox())!, (await mark.boundingBox())!]
    return Math.abs(t.y - m.y) < t.height / 2 && Math.abs(t.x - m.x) < t.height && Math.abs(t.width - m.width) < t.height
  }
  await expect.poll(covers).toBe(true)
  await panel.getByRole('button', { name: 'Weitere PDF-Aktionen' }).click()
  await page.getByRole('menuitem', { name: 'Vergrößern' }).click()
  await expect.poll(async () => (await span.boundingBox())!.width).toBeGreaterThan(box.width * 1.05)
  await expect.poll(covers).toBe(true)

  // Nach dem Neuladen ist sie wieder da; ein Klick darauf öffnet Kommentar und Farbe
  await page.reload()
  await expect(panel.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 15_000 })
  await expect(mark).toHaveCount(1)
  await expect.poll(covers).toBe(true)
  box = (await mark.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  const annotationBar = panel.getByTestId('pdf-annotation')
  await annotationBar.getByLabel('Kommentar').fill('Klausurrelevant')
  await annotationBar.getByRole('radio', { name: 'Grün' }).click()
  await expect(mark).toHaveAttribute('data-color', '4')
  await expect.poll(saved).toEqual([expect.objectContaining({ comment: 'Klausurrelevant', color: 4 })])

  // Seitenleiste „Anmerkungen“
  await panel.getByRole('button', { name: 'Anmerkungen', exact: true }).click()
  const list = panel.getByTestId('pdf-annotations')
  await expect(list.getByRole('region', { name: 'Seite 2' })).toContainText('Die Entropie nimmt nie ab')
  await expect(list).toContainText('Klausurrelevant')
  await shot(page, '55-pdf-annotations')

  // Als Zitat mit Seitenlink in die Notiz
  await list.getByRole('button', { name: 'Alle als Zitate einfügen' }).click()
  await expect(page.getByText('Zitat in „Entropie Mitschrift“ eingefügt.')).toBeVisible()
  await expect
    .poll(async () => (await page.evaluate((id) => fetch(`/api/notes/${id}`).then((r) => r.json()), note.id)).note.content)
    .toContain('> Die Entropie nimmt nie ab\n> [[Skript Wärme.pdf#page=2|S. 2]]')

  // Löschen (rückgängig machbar)
  box = (await mark.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await annotationBar.getByRole('button', { name: 'Markierung löschen' }).click()
  await expect(mark).toHaveCount(0)
  await expect.poll(async () => (await saved()).length).toBe(0)

  // Ohne Verbindung markiert: wartet im Browser und landet nach dem Wiederverbinden auf dem Server
  // (nur die Anmerkungen offline – sonst stören Ladefehler anderer Dateien die Prüfung der Konsole)
  const queued = () =>
    page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.startsWith('noted:pdf:annotations:'))
      return key ? (JSON.parse(localStorage.getItem(key)!).upserts?.length ?? 0) : 0
    })
  const offline = '**/api/attachments/*/annotations'
  await page.context().route(offline, (route) => route.abort('internetdisconnected'))
  await list.getByRole('button', { name: 'Anmerkungen schließen' }).click()
  await markText()
  await expect(mark).toHaveCount(1)
  await expect.poll(queued).toBe(1)
  await expect.poll(async () => (await saved()).length).toBe(0)
  await page.context().unroute(offline)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect.poll(async () => (await saved()).length, { timeout: 15_000 }).toBe(1)
  await expect.poll(queued).toBe(0)
})

test('PDF-Rückverweise: Notizen zur offenen Seite und zum ganzen PDF, ein Klick öffnet die Notiz', async ({ page }) => {
  await login(page)
  const headers = await apiHeaders(page)
  const pdf = makePdf([['Kapitel 1'], ['Zweiter Hauptsatz'], ['Kreisprozesse']])
  const up = await page.request.post('/api/attachments', {
    headers,
    multipart: { file: { name: 'Skript Rückverweise.pdf', mimeType: 'application/pdf', buffer: pdf } },
  })
  const att = (await up.json()).attachment as { id: string }
  cleanup.push(`/api/attachments/${att.id}`)
  const lecture = await post(page, '/api/notes', { title: 'Entropie Rückverweis', content: 'Siehe [[Skript Rückverweise.pdf#page=2]]\n', folderId: null }, 'note')
  const overview = await post(page, '/api/notes', { title: 'Gesamtüberblick Rückverweis', content: '![[Skript Rückverweise.pdf]]\n', folderId: null }, 'note')
  cleanup.push(`/api/notes/${lecture.id}?permanent=1`, `/api/notes/${overview.id}?permanent=1`)

  await page.goto(`/?n=${lecture.id}`)
  await page.getByRole('radio', { name: 'Lesen' }).click()
  await page.locator('.markdown-body a.file-link-pdf').click()
  const panel = page.getByTestId('pdf-panel')
  await expect(panel.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 15_000 })
  await expect(panel.getByLabel('Seite', { exact: true })).toHaveValue('2')

  await panel.getByRole('button', { name: 'Notizen zu diesem PDF' }).click()
  const refs = panel.getByTestId('pdf-references')
  // Diese Seite: nur die Notiz mit dem Seitenlink
  await expect(refs.getByRole('button', { name: 'Entropie Rückverweis' })).toBeVisible()
  await expect(refs.getByRole('button', { name: 'Gesamtüberblick Rückverweis' })).toHaveCount(0)
  await shot(page, '96-pdf-references')
  await refs.getByRole('tab', { name: 'Ganzes PDF' }).click()
  const whole = refs.getByRole('listitem').filter({ hasText: 'Gesamtüberblick Rückverweis' })
  await expect(whole).toContainText('Ganzes PDF')
  await expect(refs.getByRole('listitem').filter({ hasText: 'Entropie Rückverweis' })).toContainText('S.2')

  // Ein Klick öffnet die Notiz, das PDF bleibt offen
  await whole.getByRole('button', { name: 'Gesamtüberblick Rückverweis' }).click()
  await expect(page).toHaveURL(new RegExp(`n=${overview.id}`))
  await expect(panel.locator('.pdfViewer .page canvas').first()).toBeVisible()
  await expect(refs).toBeVisible()

  // „PDF hochladen …“ im Viewer bettet die Datei in die offene Notiz ein
  const extra = makePdf([['Nachtrag']])
  await panel.locator('input[type="file"]').setInputFiles({ name: 'Nachtrag Rückverweis.pdf', mimeType: 'application/pdf', buffer: extra })
  await expect(page.getByText('„Nachtrag Rückverweis.pdf“ in „Gesamtüberblick Rückverweis“ eingefügt.')).toBeVisible()
  const added = ((await (await page.request.get('/api/attachments')).json()).attachments as { id: string; filename: string }[]).find(
    (a) => a.filename === 'Nachtrag Rückverweis.pdf',
  )!
  cleanup.push(`/api/attachments/${added.id}`)
  await expect
    .poll(async () => (await (await page.request.get(`/api/notes/${overview.id}`)).json()).note.content, { timeout: 10_000 })
    .toContain('![[Nachtrag Rückverweis.pdf]]')
})

test('PDF-Seite als Bild in der Notiz: Breite, fehlende Seite bleibt Karte, im Druck – ein Klick öffnet den Viewer', async ({ page }) => {
  await login(page)
  const headers = await apiHeaders(page)
  const pdf = makePdf([['Titelseite'], ['Abbildung zwei'], ['Kreisprozess drei']])
  const up = await page.request.post('/api/attachments', {
    headers,
    multipart: { file: { name: 'Skript Seitenbild.pdf', mimeType: 'application/pdf', buffer: pdf } },
  })
  const att = (await up.json()).attachment as { id: string }
  cleanup.push(`/api/attachments/${att.id}`)
  const content = [
    '![[Skript Seitenbild.pdf#page=2]]',
    '![[Skript Seitenbild.pdf#page=3|300]]',
    '![[Skript Seitenbild.pdf#page=9]]',
    '![[Skript Seitenbild.pdf]]',
  ].join('\n\n')
  const note = await post(page, '/api/notes', { title: 'Seitenbilder', content, folderId: null }, 'note')
  cleanup.push(`/api/notes/${note.id}?permanent=1`)

  await page.goto(`/?n=${note.id}`)
  await page.getByRole('radio', { name: 'Lesen' }).click()
  const images = page.locator('.markdown-body a.embed-pdf-page img')
  await expect(images).toHaveCount(2, { timeout: 15_000 })
  await expect(images.first()).toHaveAttribute('alt', 'Skript Seitenbild.pdf, Seite 2')
  expect(Math.round((await images.nth(1).boundingBox())!.width)).toBe(300)
  // Keine solche Seite: Die Karte bleibt; ohne Seite sieht die Einbettung aus wie bisher
  await expect(page.locator('.markdown-body a.embed-pdf-page[data-page="9"]')).toHaveText('Skript Seitenbild.pdf · Seite 9')
  await expect(page.locator('.markdown-body a.embed-pdf:not(.embed-pdf-page)')).toHaveText('Skript Seitenbild.pdf')
  await shot(page, '97-pdf-page-images')

  // Im Druck sind die Bilder da, sobald gedruckt werden kann
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click()
  await page.getByRole('menuitem', { name: 'Drucken …' }).click()
  const view = page.getByTestId('print-view')
  await expect(view.getByRole('button', { name: 'Drucken', exact: true })).toBeEnabled({ timeout: 15_000 })
  await expect(page.getByTestId('print-sheet').locator('a.embed-pdf-page img')).toHaveCount(2)
  await page.keyboard.press('Escape')
  await expect(view).toHaveCount(0)

  // Ein Klick auf das Bild öffnet den Viewer auf der Seite
  await images.first().click()
  const panel = page.getByTestId('pdf-panel')
  await expect(panel.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 15_000 })
  await expect(panel.getByLabel('Seite', { exact: true })).toHaveValue('2')
})

test('PDF-Ansicht: Folienmodus, Drehen mit Markierung, Nachtmodus – Zoom, Drehung und Seite je PDF gemerkt', async ({ page }) => {
  await login(page)
  const headers = await apiHeaders(page)
  const pdf = makePdf([['Folie eins'], ['Folie zwei', 'Die Entropie nimmt nie ab'], ['Folie drei']])
  const up = await page.request.post('/api/attachments', {
    headers,
    multipart: { file: { name: 'Folien Ansicht.pdf', mimeType: 'application/pdf', buffer: pdf } },
  })
  const att = (await up.json()).attachment as { id: string }
  cleanup.push(`/api/attachments/${att.id}`)
  const note = await post(page, '/api/notes', { title: 'Ansicht Mitschrift', content: '[[Folien Ansicht.pdf]]\n', folderId: null }, 'note')
  cleanup.push(`/api/notes/${note.id}?permanent=1`)

  await page.goto(`/?n=${note.id}`)
  await page.getByRole('radio', { name: 'Lesen' }).click()
  await page.locator('.markdown-body a.file-link-pdf').click()
  const panel = page.getByTestId('pdf-panel')
  await expect(panel.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 15_000 })
  const menu = async (name: string) => {
    await panel.getByRole('button', { name: 'Weitere PDF-Aktionen' }).click()
    await page.getByRole('menuitem', { name }).click()
  }
  const pageNumber = panel.getByLabel('Seite', { exact: true })
  const pages = panel.locator('.pdfViewer .page:visible')

  // Folienmodus: genau eine Seite, → blättert weiter
  await menu('Folienmodus')
  await expect(pages).toHaveCount(1)
  await panel.locator('.pdf-container').focus()
  await page.keyboard.press('ArrowRight')
  await expect(pageNumber).toHaveValue('2')
  await expect(pages).toHaveCount(1)
  await shot(page, '98-pdf-slides')
  await menu('Fortlaufend scrollen')
  await expect(pages).toHaveCount(3)

  // Drehen: Die Markierung bleibt auf dem markierten Text
  const span = panel.locator('.page[data-page-number="2"] .textLayer span', { hasText: 'Die Entropie nimmt nie ab' })
  await span.scrollIntoViewIfNeeded()
  const b = (await span.boundingBox())!
  await page.mouse.move(b.x + 1, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width - 1, b.y + b.height / 2, { steps: 10 })
  await page.mouse.up()
  await panel.getByTestId('pdf-selection').getByRole('button', { name: 'Markieren' }).click()
  const mark = panel.locator('.page[data-page-number="2"] .pdf-annotation')
  await expect(mark).toHaveCount(1)
  await menu('Nach rechts drehen')
  const inside = async () => {
    const m = await mark.boundingBox()
    const t = await span.boundingBox()
    if (!m || !t) return false
    const tol = 4
    return m.x >= t.x - tol && m.y >= t.y - tol && m.x + m.width <= t.x + t.width + tol && m.y + m.height <= t.y + t.height + tol
  }
  await expect.poll(inside).toBe(true)
  // Quer: die Seite ist jetzt breiter als hoch
  const landscape = async () => {
    const box = (await panel.locator('.page[data-page-number="1"]').boundingBox())!
    return box.width > box.height
  }
  await expect.poll(landscape).toBe(true)

  // Nachtmodus und Zoom
  await menu('Nachtmodus')
  await expect(panel.locator('.pdf-container')).toHaveClass(/pdf-night/)
  await panel.locator('.pdf-container').focus()
  await page.keyboard.press('+')
  await page.keyboard.press('+')
  const width = async () => Math.round((await panel.locator('.page[data-page-number="1"]').boundingBox())!.width)
  await expect.poll(width).toBeGreaterThan(0)
  const zoomed = await width()

  // Nach dem Neuladen: dieselbe Ansicht
  await page.reload()
  await expect(panel.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: 15_000 })
  await expect(panel.locator('.pdf-container')).toHaveClass(/pdf-night/)
  await expect.poll(landscape).toBe(true)
  await expect.poll(width).toBe(zoomed)
  await expect(pageNumber).toHaveValue('2')
  await menu('Nachtmodus ausschalten')
  await expect(panel.locator('.pdf-container')).not.toHaveClass(/pdf-night/)
})

test('FSRS-Parameter aus dem Lernverlauf optimieren und zurücksetzen', async ({ page }) => {
  await login(page)
  const deck = await post(page, '/api/decks', { name: 'FSRS-Optimierung', scheduler: 'fsrs' }, 'deck')
  cleanup.push(`/api/decks/${deck.id}`)
  // Die Parameter gelten für das ganze Konto – danach wieder Standardwerte für die übrigen Tests
  cleanup.push('/api/flashcards/fsrs')
  const cards = await post<Created[]>(
    page,
    `/api/decks/${deck.id}/cards`,
    { cards: Array.from({ length: 60 }, (_, i) => ({ type: 'basic', front: `Begriff ${i}`, back: `Bedeutung ${i}` })) },
    'cards',
  )
  // Ein Verlauf, der viel schlechter erinnert wird, als die Standardwerte vorhersagen: nach 1–3 Tagen nur die Hälfte
  const start = Date.now() - 120 * DAY
  const log = cards.flatMap((card, i) => {
    const entry = (rating: number, phase: string, reviewedAt: number) => ({
      cardId: card.id,
      side: 0,
      rating,
      phase,
      intervalBefore: 0,
      intervalAfter: 0,
      durationMs: 4000,
      reviewedAt,
    })
    const first = start + (i % 10) * DAY + i * 60_000
    const second = first + (1 + (i % 3)) * DAY
    const third = second + (2 + (i % 4)) * DAY
    return [
      entry(3, 'new', first),
      entry(3, 'learning', first + 600_000),
      entry(i % 2 ? 3 : 1, 'review', second),
      ...(i % 2 ? [] : [entry(3, 'relearning', second + 600_000)]),
      entry(i % 4 < 2 ? 1 : 3, 'review', third),
    ]
  })
  await post(page, '/api/reviews', { reviews: [], log }, 'logged')

  await page.goto('/?v=cards')
  await page.getByRole('button', { name: 'Lernstatistik' }).click()
  const panel = page.getByTestId('stats-fsrs')
  await expect(panel).toContainText('Standardwerte von FSRS-5')
  await panel.getByRole('button', { name: 'Parameter optimieren' }).click()
  await expect(page.getByText(/^Parameter angepasst – Abweichung .* → .*\.$/)).toBeVisible()
  await expect(panel).toContainText('An deinen Lernverlauf angepasst')
  await expect(panel).toContainText('Eigene Werte')
  await shot(page, '39-fsrs')

  await panel.getByRole('button', { name: 'Standardwerte' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Standardwerte' }).click()
  await expect(panel).toContainText('Standardwerte von FSRS-5')
  expect((await (await page.request.get('/api/flashcards')).json()).fsrs).toBeNull()
})
