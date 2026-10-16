import { route } from '@/features/auth/server/route'
import { getNote } from '@/features/notes/server/notes'

/** Notiz als .md-Datei herunterladen */
export const GET = route<{ id: string }>('user', ({ user, params }) => {
  const note = getNote(user.id, params.id)
  const filename = `${note.title}.md`
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return new Response(note.content, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
})
