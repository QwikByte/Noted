import { expect, test, type Page } from '@playwright/test'
import { apiHeaders } from './helpers'

// Startseite als Dashboard: Termine der nächsten Tage aus dem eigenen Kalender und fällige Karteikarten.
// Die Uhr im Browser steht auf Montag, 19.10.2026, 9 Uhr.

const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'E2E-Admin-Passwort-1'
const SHOTS = process.env.SCREENSHOT_DIR

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

/** Dialog mit dieser Überschrift */
const dialog = (page: Page, title: string) =>
  page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: title, exact: true }) })

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Benutzername').fill('admin')
  await page.getByLabel('Passwort', { exact: true }).fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Administrator')
}

const event = (title: string, start: string, end: string, extra: object = {}) => ({
  title,
  location: '',
  notes: '',
  color: null,
  allDay: start.length === 10,
  start,
  end,
  repeat: null,
  exdates: [],
  ...extra,
})

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

test('Termine auf der Startseite, Mitschrift zum Termin, Termin anlegen', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-19T09:00:00+02:00') })
  await login(page)
  const agenda = page.getByTestId('agenda')
  await expect(agenda).toContainText('Noch keine Termine')

  const headers = await apiHeaders(page)
  for (const data of [
    event('Analysis I', '2026-10-12T10:15', '2026-10-12T11:45', { location: 'Hörsaal 1', repeat: { weeks: 1, until: null } }),
    event('Übung Analysis', '2026-10-20T14:00', '2026-10-20T15:30'),
    event('Exkursion', '2026-10-21', '2026-10-23'),
    event('Klausur', '2026-10-30T09:00', '2026-10-30T11:00'),
  ]) {
    expect((await page.request.post('/api/calendar', { headers, data })).status()).toBe(201)
  }
  await page.reload()

  // Heute, morgen, mehrtägig ganztägig; die Klausur liegt nach den nächsten sieben Tagen
  await expect(agenda.getByText('Heute')).toBeVisible()
  const lecture = agenda.getByTestId('agenda-event').filter({ hasText: 'Analysis I' })
  await expect(lecture).toContainText('10:15–11:45')
  await expect(lecture).toContainText('Hörsaal 1')
  await expect(agenda.getByText('Morgen')).toBeVisible()
  await expect(agenda.getByTestId('agenda-event').filter({ hasText: 'Übung Analysis' })).toContainText('14:00–15:30')
  await expect(agenda.getByTestId('agenda-event').filter({ hasText: 'Exkursion' })).toHaveCount(2)
  await expect(agenda.getByTestId('agenda-event').filter({ hasText: 'Exkursion' }).first()).toContainText('Ganztägig')
  await expect(agenda).not.toContainText('Klausur')
  await shot(page, '61-dashboard')

  // Mitschrift zum Termin: Vorlage „Vorlesung“, Titel aus Datum und Termin
  await lecture.getByRole('button', { name: 'Mitschrift' }).click()
  const newNote = page.getByRole('dialog')
  const title = newNote.getByLabel(/Titel/)
  await expect(title).toHaveValue('2026-10-19 Analysis I')
  await newNote.getByRole('button', { name: 'Erstellen' }).click()
  await expect(page.getByTestId('note-title')).toHaveValue('2026-10-19 Analysis I')
  cleanup.push(`/api/notes/${new URL(page.url()).searchParams.get('n')}?permanent=1`)
  // Danach öffnet derselbe Termin die vorhandene Mitschrift
  await page.goto('/')
  await lecture.getByRole('button', { name: 'Öffnen' }).click()
  await expect(page.getByTestId('note-title')).toHaveValue('2026-10-19 Analysis I')

  // Neuer Termin direkt von der Startseite – heute zur nächsten vollen Stunde
  await page.goto('/')
  await agenda.getByRole('button', { name: 'Termin anlegen' }).click()
  const add = dialog(page, 'Neuer Termin')
  await add.getByLabel('Titel').fill('Sprechstunde')
  await add.getByRole('button', { name: 'Speichern' }).click()
  await expect(add).toBeHidden()
  await expect(agenda.getByTestId('agenda-event').filter({ hasText: 'Sprechstunde' })).toContainText('10:00–11:00')

  // Ein Klick auf den Termin öffnet ihn zum Bearbeiten, „Kalender“ den ganzen Kalender
  await agenda.getByRole('button', { name: /Übung Analysis/ }).click()
  await expect(dialog(page, 'Termin bearbeiten').getByLabel('Titel')).toHaveValue('Übung Analysis')
  await page.keyboard.press('Escape')
  await agenda.getByRole('button', { name: 'Kalender', exact: true }).click()
  await expect(page).toHaveURL(/\?v=calendar$/)
})

test('Fällige Karteikarten auf der Startseite', async ({ page }) => {
  await login(page)
  // Ohne Stapel kein Kasten
  await expect(page.getByTestId('due-decks')).toHaveCount(0)
  const headers = await apiHeaders(page)
  const deck = (await (await page.request.post('/api/decks', { headers, data: { name: 'Analysis' } })).json()).deck
  cleanup.push(`/api/decks/${deck.id}`)
  await page.request.post(`/api/decks/${deck.id}/cards`, {
    headers,
    data: { cards: [{ type: 'basic', front: 'Grenzwert?', back: 'Ja' }, { type: 'basic', front: 'Folge?', back: 'Ja' }] },
  })
  await page.reload()
  const due = page.getByTestId('due-decks')
  await expect(due.getByRole('button', { name: /Analysis\s*2 fällig/ })).toBeVisible()
  await due.getByRole('button', { name: /Analysis/ }).click()
  await expect(page.getByTestId('study')).toBeVisible()
})
