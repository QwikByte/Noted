import { route } from '@/features/auth/server/route'
import { zipStream } from '@/shared/server/zip'
import { exportDeckPackage } from '@/features/flashcards/server/deck-package'

/** Stapel als Datei (.noted-deck.zip) – lässt sich in ein anderes Konto oder eine andere Noted-Instanz importieren */
export const GET = route<{ id: string }>('user', ({ user, params }) => {
  const { filename, entries } = exportDeckPackage(user.id, params.id)
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return new Response(zipStream(entries), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
})
