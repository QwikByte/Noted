import { route } from '@/features/auth/server/route'
import { exportZipStream } from '@/features/transfer/server/transfer'

/** Alle Notizen + Anhänge als ZIP mit Ordnerstruktur */
export const GET = route('user', ({ user }) => {
  const date = new Date().toISOString().slice(0, 10)
  const filename = `Noted-Export-${user.username}-${date}.zip`
  return new Response(exportZipStream(user.id), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, '_')}"`,
    },
  })
})
