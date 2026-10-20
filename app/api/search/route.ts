import { json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { searchNotes } from '@/features/notes/server/notes'
import { searchAttachments } from '@/features/attachments/server/index'
import type { SearchResponse } from '@/features/notes/types'

export const GET = route('user', ({ req, user }) => {
  const q = (req.nextUrl.searchParams.get('q') ?? '').slice(0, 200)
  return json<SearchResponse>({ results: searchNotes(user.id, q), files: searchAttachments(user.id, q) })
})
