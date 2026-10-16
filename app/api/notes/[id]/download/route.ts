import { route } from '@/features/auth/server/route'
import { getNote } from '@/features/notes/server/notes'
import { noteExtension } from '@/features/notes/format'
import { htmlDocument } from '@/shared/lib/html'

/** Notiz als Datei herunterladen: .md (Markdown, einfacher Text) bzw. .html (formatierter Text) */
export const GET = route<{ id: string }>('user', ({ user, params }) => {
  const note = getNote(user.id, params.id)
  const html = note.format === 'richtext'
  const filename = `${note.title}${noteExtension(note.format)}`
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return new Response(html ? htmlDocument(note.title, note.content) : note.content, {
    headers: {
      'Content-Type': html ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      // Nie im Kontext der App anzeigen – das HTML stammt vom Benutzer
      'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    },
  })
})
