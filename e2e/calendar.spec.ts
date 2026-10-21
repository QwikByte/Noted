import fs from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { apiHeaders } from './helpers'

// Eigener Kalender: Woche und Monat, wöchentliche Serie mit verschobenem und ausfallendem Termin, .ics-Import und
// -Export, Tagesansicht mit Wischen auf dem Handy. Die Uhr im Browser steht auf Montag, 19.10.2026, 9 Uhr.

const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'E2E-Admin-Passwort-1'
const SHOTS = process.env.SCREENSHOT_DIR
const NOW = new Date('2026-10-19T09:00:00+02:00')

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

test.describe.configure({ mode: 'serial' })

let consoleErrors: string[] = []
test.beforeEach(({ page }) => {
  consoleErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/status of (401|403|404|409)/.test(msg.text())) consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(String(err)))
})
// Alle Specs teilen sich das Admin-Konto: Die Termine werden wieder entfernt
test.afterEach(async ({ page }) => {
  const headers = await apiHeaders(page)
  const { events } = await (await page.request.get('/api/calendar')).json()
  for (const e of events) await page.request.delete(`/api/calendar/${e.id}`, { headers })
  expect(consoleErrors, 'Fehler in der Browser-Konsole').toEqual([])
})

test('Serie anlegen, einzelnen Termin verschieben und ausfallen lassen, Monatsansicht', async ({ page }) => {
  await page.clock.install({ time: NOW })
  await login(page)
  await page.getByRole('navigation').getByRole('button', { name: 'Kalender' }).click()
  await expect(page).toHaveURL(/\?v=calendar$/)
  const label = page.getByTestId('calendar-label')
  await expect(label).toHaveText('Oktober 2026')
  await expect(page.getByTestId('calendar')).toContainText('KW 43')
  const events = page.getByTestId('calendar-event')

  // Vorlesung als wöchentliche Serie bis 9.11.
  await page.getByRole('button', { name: 'Neuer Termin' }).click()
  const add = dialog(page, 'Neuer Termin')
  await add.getByLabel('Titel').fill('Analysis I')
  await add.getByLabel('Beginn').fill('2026-10-19')
  await add.getByLabel('Uhrzeit').first().fill('10:15')
  // Das Ende wandert mit – die Dauer bleibt eine Stunde
  await expect(add.getByLabel('Uhrzeit').nth(1)).toHaveValue('11:15')
  await add.getByLabel('Uhrzeit').nth(1).fill('11:45')
  await add.getByLabel('Wiederholung').selectOption('1')
  await add.getByLabel('Bis einschließlich').fill('2026-11-09')
  await add.getByLabel('Ort').fill('Hörsaal 1')
  await add.getByRole('radio', { name: 'Orange' }).click()
  await add.getByRole('button', { name: 'Speichern' }).click()
  await expect(add).toBeHidden()
  await expect(events).toHaveCount(1)
  await expect(events.first()).toContainText('Analysis I')
  await expect(events.first()).toContainText('10:15–11:45 · Hörsaal 1')
  await shot(page, '62-calendar-week')

  // Nächste Woche: nur diesen Termin verschieben
  await page.getByRole('button', { name: 'Eine Woche weiter' }).click()
  await expect(page.getByTestId('calendar')).toContainText('KW 44')
  await events.first().click()
  const edit = dialog(page, 'Termin bearbeiten')
  await expect(edit).toContainText('Montag, 26.10.2026 · wiederholt sich')
  await expect(edit.getByRole('radio', { name: 'Nur dieser Termin' })).toHaveAttribute('aria-checked', 'true')
  await expect(edit.getByLabel('Wiederholung')).toHaveCount(0)
  await edit.getByLabel('Uhrzeit').first().fill('12:15')
  await edit.getByLabel('Ort').fill('Raum 5')
  await edit.getByRole('button', { name: 'Speichern' }).click()
  await expect(edit).toBeHidden()
  await expect(events).toHaveCount(1)
  await expect(events.first()).toContainText('12:15–13:45 · Raum 5')

  // Übernächste Woche: nur diesen Termin ausfallen lassen
  await page.getByRole('button', { name: 'Eine Woche weiter' }).click()
  await events.first().click()
  await edit.getByRole('button', { name: 'Löschen' }).click()
  await dialog(page, 'Wiederkehrenden Termin löschen?').getByRole('button', { name: 'Nur diesen' }).click()
  await expect(events).toHaveCount(0)
  // Am 9.11. findet die Serie noch statt, danach nicht mehr
  await page.getByRole('button', { name: 'Eine Woche weiter' }).click()
  await expect(events).toHaveCount(1)
  await page.getByRole('button', { name: 'Eine Woche weiter' }).click()
  await expect(events).toHaveCount(0)

  // Alle Termine umbenennen – der verschobene Einzeltermin bleibt, wie er ist
  await page.getByRole('button', { name: 'Heute' }).click()
  await events.first().click()
  await edit.getByRole('radio', { name: 'Alle Termine' }).click()
  await expect(edit.getByLabel('Wiederholung')).toHaveValue('1')
  await edit.getByLabel('Titel').fill('Analysis 1')
  await edit.getByRole('button', { name: 'Speichern' }).click()
  await expect(events.first()).toContainText('Analysis 1')

  // Monat: Termine als Einträge, ein Klick auf den Tag zeigt seine Woche
  await page.getByRole('radio', { name: 'Monat' }).click()
  await expect(label).toHaveText('Oktober 2026')
  await expect(page.getByTestId('month-2026-10-19')).toContainText('10:15Analysis 1')
  await expect(page.getByTestId('month-2026-10-26')).toContainText('12:15Analysis I')
  await expect(page.getByTestId('month-2026-11-02')).not.toContainText('Analysis')
  await shot(page, '63-calendar-month')
  await page.getByRole('button', { name: 'Montag, 26.10.2026' }).click()
  await expect(page.getByRole('radio', { name: 'Woche' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('calendar')).toContainText('KW 44')

  // Klick ins Raster: neuer Termin zur angeklickten Zeit, ungültige Eingaben werden erklärt
  await page.getByTestId('day-2026-10-28').click({ position: { x: 20, y: 15 * 48 + 30 } })
  await expect(add.getByLabel('Uhrzeit').first()).toHaveValue('15:30')
  await expect(add.getByLabel('Beginn')).toHaveValue('2026-10-28')
  await add.getByRole('button', { name: 'Speichern' }).click()
  await expect(add.getByRole('alert')).toHaveText('Bitte gib einen Titel ein.')
  await add.getByRole('button', { name: 'Abbrechen' }).click()
  await expect(add).toBeHidden()
})

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:la@uni.example',
  'SUMMARY:Lineare Algebra',
  'LOCATION:Hörsaal 3',
  'DTSTART;TZID=Europe/Berlin:20261013T081500',
  'DTEND;TZID=Europe/Berlin:20261013T094500',
  'RRULE:FREQ=WEEKLY;UNTIL=20270209T071500Z',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:mensa@uni.example',
  'SUMMARY:Mensa',
  'DTSTART:20261019T110000Z',
  'DTEND:20261019T113000Z',
  'RRULE:FREQ=DAILY;COUNT=5',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:feiertag@uni.example',
  'SUMMARY:Reformationstag',
  'DTSTART;VALUE=DATE:20261031',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

test('.ics importieren – ohne Doppelte beim zweiten Mal – und exportieren', async ({ page }) => {
  await page.clock.install({ time: NOW })
  await login(page)
  await page.goto('/?v=calendar')
  await expect(page.getByTestId('calendar-event')).toHaveCount(0)
  const file = { name: 'Stundenplan.ics', mimeType: 'text/calendar', buffer: Buffer.from(ICS) }
  await page.getByTestId('ics-input').setInputFiles(file)
  await expect(page.getByText('3 Termine importiert.')).toBeVisible()
  await expect(page.getByText('Bei 1 Serie wiederholt Noted nur wöchentlich')).toBeVisible()

  const events = page.getByTestId('calendar-event')
  await expect(events.filter({ hasText: 'Lineare Algebra' })).toContainText('08:15–09:45 · Hörsaal 3')
  // 11:00 UTC ist 13:00 in Berlin
  await expect(events.filter({ hasText: 'Mensa' })).toContainText('13:00–13:30')
  await page.getByRole('radio', { name: 'Monat' }).click()
  await expect(page.getByTestId('month-2026-10-31')).toContainText('Reformationstag')

  await page.getByTestId('ics-input').setInputFiles(file)
  await expect(page.getByText('0 Termine importiert, 3 schon vorhanden.')).toBeVisible()

  await page.getByRole('button', { name: 'Weitere Aktionen' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'Als .ics exportieren' }).click()
  const ics = await download
  expect(ics.suggestedFilename()).toBe('Kalender.ics')
  const text = fs.readFileSync(await ics.path(), 'utf8')
  expect(text).toContain('UID:la@uni.example')
  expect(text).toContain('SUMMARY:Lineare Algebra')
  expect(text).toContain('DTSTART:20261013T081500')
})

test.describe('Handy', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('Tagesansicht mit Wischen und Monat mit Punkten', async ({ page }) => {
    await page.clock.install({ time: NOW })
    await login(page)
    const headers = await apiHeaders(page)
    const data = {
      title: 'Tutorium',
      location: '',
      notes: '',
      color: 6,
      allDay: false,
      start: '2026-10-20T10:00',
      end: '2026-10-20T11:00',
      repeat: null,
      exdates: [],
    }
    expect((await page.request.post('/api/calendar', { headers, data })).status()).toBe(201)
    await page.goto('/?v=calendar')
    const label = page.getByTestId('calendar-label')
    await expect(label).toHaveText('Montag, 19.10.2026')
    await expect(page.getByTestId('calendar-event')).toHaveCount(0)

    // Nach links wischen: nächster Tag
    const cdp = await page.context().newCDPSession(page)
    const swipe = async (from: number, to: number) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from, y: 500 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: (from + to) / 2, y: 502 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: to, y: 504 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    await swipe(320, 80)
    await expect(label).toHaveText('Dienstag, 20.10.2026')
    await expect(page.getByTestId('calendar-event')).toContainText('Tutorium')
    await shot(page, '64-calendar-phone')
    await swipe(80, 320)
    await expect(label).toHaveText('Montag, 19.10.2026')

    // Monat: Punkte statt Einträgen, ein Tipp auf den Tag zeigt ihn
    await page.getByRole('radio', { name: 'Monat' }).click()
    await expect(page.getByTestId('calendar-event')).toHaveCount(0)
    await page.getByTestId('month-2026-10-20').click()
    await expect(label).toHaveText('Dienstag, 20.10.2026')
    await expect(page.getByRole('radio', { name: 'Tag' })).toHaveAttribute('aria-checked', 'true')
  })
})
