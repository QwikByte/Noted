import 'server-only'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getSession, SESSION_COOKIE } from './session'
import { pendingSetup, toPublicUser, type UserRow } from './users'

export async function getPageSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  return getSession(token)
}

/** Für App-Seiten: angemeldet, MFA erledigt und keine ausstehende Kontoeinrichtung. */
export async function requireAppUser(opts: { admin?: boolean } = {}): Promise<UserRow> {
  const found = await getPageSession()
  if (!found || found.session.stage !== 'full') redirect('/login')
  if (pendingSetup(found.user)) redirect('/setup')
  if (opts.admin && found.user.role !== 'admin') redirect('/')
  return found.user
}

export { toPublicUser }
