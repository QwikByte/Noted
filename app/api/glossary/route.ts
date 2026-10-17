import { badRequest, json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { isValidId } from '@/shared/server/crypto'
import { getGlossary } from '@/features/glossary/server/glossary'

/** Glossar und Formelsammlung – `?folder=<id>` für einen Ordner samt Unterordnern */
export const GET = route('user', ({ req, user }) => {
  const folder = req.nextUrl.searchParams.get('folder')
  if (folder && !isValidId(folder)) throw badRequest('Unbekannter Ordner.')
  return json(getGlossary(user.id, folder || null))
})
