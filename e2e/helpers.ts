// Gemeinsame Helfer für die Browser-Tests
import type { Page } from '@playwright/test'

/** Schreibende API-Anfragen wie die App (CSRF-Header) */
export async function apiHeaders(page: Page) {
  const me = await page.evaluate(() => fetch('/api/auth/me').then((r) => r.json()))
  return { 'x-noted-request': '1', 'x-noted-user': String(me.user.id) }
}

export { makePdf } from '../tests/pdf'
