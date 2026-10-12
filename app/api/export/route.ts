import { route } from '@/lib/server/http'
import { exportVaultStream } from '@/lib/server/vault'

/** Alle Notizen + Anhänge als ZIP (direkt als Obsidian-Vault nutzbar) */
export const GET = route('user', ({ user }) => {
  const date = new Date().toISOString().slice(0, 10)
  const filename = `Noted-Export-${user.username}-${date}.zip`
  return new Response(exportVaultStream(user.id), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, '_')}"`,
    },
  })
})
