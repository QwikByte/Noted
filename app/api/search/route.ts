import { z } from 'zod'
import { badRequest, json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { searchNotes } from '@/features/notes/server/notes'
import { searchAttachments } from '@/features/attachments/server/index'
import type { SearchResponse } from '@/features/notes/types'

const folderSchema = z.string().uuid()

export const GET = route('user', ({ req, user }) => {
  const params = req.nextUrl.searchParams
  const q = (params.get('q') ?? '').slice(0, 200)
  const folder = params.get('folder')
  if (folder !== null && !folderSchema.safeParse(folder).success) throw badRequest('Ungültiger Ordner.')
  // Dateien gehören keinem Ordner fest an – mit Ordnerfilter gibt es nur Notizen
  return json<SearchResponse>({
    results: searchNotes(user.id, q, { folderId: folder ?? undefined }),
    files: folder ? [] : searchAttachments(user.id, q),
  })
})
