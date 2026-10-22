/** Wird einmal beim Serverstart ausgeführt: Datenbank öffnen, migrieren und ggf. den ersten Admin anlegen. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { getDb } = await import('@/shared/server/db')
  const { bootstrapAdmin } = await import('@/features/auth/server/bootstrap')
  const { purgeExpiredSessions } = await import('@/features/auth/server/session')
  const { purgeTrash } = await import('@/features/notes/server/notes')
  const { purgeVersions } = await import('@/features/notes/server/versions')
  const { purgeExpiredShares } = await import('@/features/sharing/server/shares')
  bootstrapAdmin(getDb())
  const cleanup = () => {
    try {
      purgeExpiredSessions()
      purgeTrash()
      purgeVersions()
      purgeExpiredShares()
    } catch (err) {
      console.error('[noted] Aufräumen fehlgeschlagen', err)
    }
  }
  cleanup()
  setInterval(cleanup, 6 * 60 * 60 * 1000).unref()
  // Anhänge, die noch nie gelesen wurden (z. B. wegen eines Neustarts mitten im Lesen), nach und nach lesen
  try {
    const { indexMissing } = await import('@/features/attachments/server/index')
    indexMissing()
  } catch (err) {
    console.error('[noted] Nachholen der Volltextsuche in Dateien fehlgeschlagen', err)
  }
}
