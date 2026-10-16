import { z } from 'zod'
import { ApiError, json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { audit } from '@/shared/server/audit'
import { canRequestUpdate, readUpdateRequest, requestUpdate } from '@/features/updates/server/update-status'

const schema = z.object({ retry: z.boolean().optional() })

/** Update-Prüfung sofort anstoßen (holt der Update-Dienst auf dem Server ab) */
export const POST = route('admin', async ({ req, user, ip }) => {
  const { retry = false } = await parseJson(req, schema)
  if (!canRequestUpdate()) {
    throw new ApiError(
      503,
      'update_unavailable',
      'Der Update-Dienst ist auf diesem Server nicht eingerichtet (siehe README, „Automatische Updates“).',
    )
  }
  requestUpdate({ retry, by: user.username })
  audit({ event: 'update_requested', actorId: user.id, actorUsername: user.username, ip, details: { retry } })
  return json({ updateRequest: readUpdateRequest() })
})
