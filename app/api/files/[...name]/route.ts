import { route } from '@/features/auth/server/route'
import { attachmentResponse, getAttachmentByName } from '@/features/attachments/server/attachments'

/** Anhang über den Dateinamen abrufen – so lassen sich Obsidian-Einbettungen wie ![[foto.jpg]] auflösen. */
export const GET = route<{ name: string[] }>('user', ({ req, user, params }) => {
  // Next.js liefert die Pfadsegmente bereits dekodiert
  const name = params.name.join('/')
  const att = getAttachmentByName(user.id, name)
  return attachmentResponse(user.id, att, req.headers.get('range'), req.nextUrl.searchParams.get('download') === '1')
})
