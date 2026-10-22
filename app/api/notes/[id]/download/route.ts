import { route } from '@/features/auth/server/route'
import { badRequest } from '@/shared/server/http'
import { getNote } from '@/features/notes/server/notes'
import { noteExtension } from '@/features/notes/format'
import { canvasForExport } from '@/features/canvas/canvas'
import { exportIndex } from '@/features/transfer/server/transfer'
import { htmlDocument } from '@/shared/lib/html'

const CONTENT_TYPES = { '.md': 'text/markdown', '.html': 'text/html', '.canvas': 'application/json' } as const

/** Notiz als Datei herunterladen: .md (Markdown, einfacher Text, Mindmap), .html (formatierter Text), .canvas */
export const GET = route<{ id: string }>('user', ({ user, params }) => {
  const note = getNote(user.id, params.id)
  // Der Server hat für Tresor-Notizen nur Chiffretext – herunterladen geht im entsperrten Browser
  if (note.vault) throw badRequest('Notizen im Tresor lädt die App selbst herunter, nicht der Server.')
  const ext = noteExtension(note.format)
  const filename = `${note.title}${ext}`
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  const body =
    note.format === 'richtext'
      ? htmlDocument(note.title, note.content)
      : note.format === 'canvas'
        ? canvasForExport(note.content, exportIndex(user.id))
        : note.content
  return new Response(body, {
    headers: {
      'Content-Type': `${CONTENT_TYPES[ext]}; charset=utf-8`,
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      // Nie im Kontext der App anzeigen – das HTML stammt vom Benutzer
      'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    },
  })
})
