import { expect, test, type Page } from '@playwright/test'
import { apiHeaders } from './helpers'

// Startseite als Dashboard: Termine aus dem Microsoft-Kalender (gegen die Attrappe aus scripts/e2e-microsoft.mjs)
// und fällige Karteikarten.

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
  expect(consoleErrors, 'Fehler in der Browser-Konsole').toEqual([])
})

test('Kalender verbinden, Termine auf der Startseite, Mitschrift zum Termin, trennen', async ({ page }) => {
  await login(page)
  const agenda = page.getByTestId('agenda')
  await expect(agenda).toContainText('Verbinde deinen Microsoft-Kalender')

  // Verbinden: weiter zu Microsoft (Attrappe) und zurück in die Einstellungen
  await agenda.getByRole('button', { name: 'Mit Microsoft verbinden' }).click()
  await expect(page.getByText('Kalender verbunden.')).toBeVisible()
  await expect(page).toHaveURL(/\/settings#kalender$/)
  const section = page.locator('#kalender')
  await expect(section).toContainText('Verbunden als Mia Muster (mia@uni.example)')
  // Neben dem Standardkalender auch den Stundenplan zeigen
  await expect(section.getByRole('checkbox', { name: /Kalender\s*Standard/ })).toBeChecked()
  const timetable = section.getByRole('checkbox', { name: /Stundenplan/ })
  await expect(timetable).not.toBeChecked()
  await timetable.check()
  await expect(timetable).toBeChecked()
  await shot(page, '60-calendar-settings')

  // Startseite: heute, morgen, ganztägig; Abgesagtes fehlt
  await page.goto('/')
  await expect(agenda.getByText('Heute')).toBeVisible()
  const lecture = agenda.getByTestId('agenda-event').filter({ hasText: 'Analysis I' })
  await expect(lecture).toContainText('10:15–11:45')
  await expect(lecture).toContainText('Hörsaal 1')
  await expect(lecture.getByRole('link', { name: 'Analysis I: online teilnehmen' })).toHaveAttribute(
    'href',
    'https://teams.microsoft.com/l/meetup-join/e2e',
  )
  await expect(agenda.getByText('Morgen')).toBeVisible()
  await expect(agenda.getByTestId('agenda-event').filter({ hasText: 'Übung Analysis' })).toContainText('14:00–15:30')
  await expect(agenda.getByTestId('agenda-event').filter({ hasText: 'Exkursion' })).toContainText('Ganztägig')
  await expect(agenda).not.toContainText('Abgesagt')
  await shot(page, '61-dashboard')

  // Mitschrift zum Termin: Vorlage „Vorlesung“, Titel aus Datum und Termin
  await lecture.getByRole('button', { name: 'Mitschrift' }).click()
  const dialog = page.getByRole('dialog')
  const title = dialog.getByLabel(/Titel/)
  await expect(title).toHaveValue(/^\d{4}-\d{2}-\d{2} Analysis I$/)
  const noteTitle = await title.inputValue()
  await dialog.getByRole('button', { name: 'Erstellen' }).click()
  await expect(page.getByTestId('note-title')).toHaveValue(noteTitle)
  cleanup.push(`/api/notes/${new URL(page.url()).searchParams.get('n')}?permanent=1`)
  // Danach öffnet derselbe Termin die vorhandene Mitschrift
  await page.goto('/')
  await lecture.getByRole('button', { name: 'Öffnen' }).click()
  await expect(page.getByTestId('note-title')).toHaveValue(noteTitle)

  // Trennen
  await page.goto('/settings')
  await section.getByRole('button', { name: 'Trennen' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Trennen' }).click()
  await expect(page.getByText('Kalender getrennt.')).toBeVisible()
  await expect(section.getByRole('button', { name: 'Mit Microsoft verbinden' })).toBeVisible()
  await page.goto('/')
  await expect(agenda).toContainText('Verbinde deinen Microsoft-Kalender')
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
