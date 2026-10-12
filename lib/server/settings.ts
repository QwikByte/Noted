import 'server-only'
import { getDb } from './db'

export type AppSettings = {
  /** MFA für alle Benutzer verpflichtend */
  enforceMfa: boolean
}

const defaults: AppSettings = { enforceMfa: false }

export function getSettings(): AppSettings {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  const map = new Map(rows.map((r) => [r.key, r.value]))
  return {
    enforceMfa: map.has('enforce_mfa') ? map.get('enforce_mfa') === '1' : defaults.enforceMfa,
  }
}

export function updateSettings(patch: Partial<AppSettings>) {
  const db = getDb()
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  )
  if (patch.enforceMfa !== undefined) upsert.run('enforce_mfa', patch.enforceMfa ? '1' : '0')
}
