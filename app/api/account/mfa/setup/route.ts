import { json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { startMfaSetup } from '@/features/auth/server/auth'

/** Startet die MFA-Einrichtung: neues Geheimnis + QR-Code */
export const POST = route('setup', async ({ user }) => {
  return json(await startMfaSetup(user))
})
