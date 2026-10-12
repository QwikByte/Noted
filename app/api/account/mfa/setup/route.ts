import { json, route } from '@/lib/server/http'
import { startMfaSetup } from '@/lib/server/auth'

/** Startet die MFA-Einrichtung: neues Geheimnis + QR-Code */
export const POST = route('setup', async ({ user }) => {
  return json(await startMfaSetup(user))
})
