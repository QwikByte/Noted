import { json, route } from '@/lib/server/http'
import { searchNotes } from '@/lib/server/notes'

export const GET = route('user', ({ req, user }) => {
  const q = (req.nextUrl.searchParams.get('q') ?? '').slice(0, 200)
  return json({ results: searchNotes(user.id, q) })
})
