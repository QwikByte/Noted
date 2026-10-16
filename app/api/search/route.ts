import { json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { searchNotes } from '@/features/notes/server/notes'

export const GET = route('user', ({ req, user }) => {
  const q = (req.nextUrl.searchParams.get('q') ?? '').slice(0, 200)
  return json({ results: searchNotes(user.id, q) })
})
