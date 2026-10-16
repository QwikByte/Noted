import { z } from 'zod'
import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { getSettings, updateSettings } from '@/features/auth/server/settings'
import { audit } from '@/shared/server/audit'

export const GET = route('admin', () => json({ settings: getSettings() }))

const schema = z.object({ enforceMfa: z.boolean().optional() })

export const PATCH = route('admin', async ({ req, user, ip }) => {
  const body = await parseJson(req, schema)
  updateSettings(body)
  audit({ event: 'settings_changed', actorId: user.id, actorUsername: user.username, ip, details: body })
  return json({ settings: getSettings() })
})
