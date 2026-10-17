import { expect, test, type Page } from '@playwright/test'
import { apiHeaders } from './helpers'

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
    if (msg.type() === 'error' && !/status of (401|403|404|409)/.test(msg.text())) consoleErrors.push(msg.text())
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
