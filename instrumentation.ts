/** Wird einmal beim Serverstart ausgeführt: Datenbank öffnen, migrieren und ggf. den ersten Admin anlegen. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { getDb } = await import('./lib/server/db')
  const { purgeExpiredSessions } = await import('./lib/server/session')
  const { purgeTrash } = await import('./lib/server/notes')
  getDb()
  const cleanup = () => {
    try {
      purgeExpiredSessions()
      purgeTrash()
    } catch (err) {
      console.error('[noted] Aufräumen fehlgeschlagen', err)
    }
  }
  cleanup()
  setInterval(cleanup, 6 * 60 * 60 * 1000).unref()
}
