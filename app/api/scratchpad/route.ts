import { z } from 'zod'
import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { getScratchpad, saveScratchpad } from '@/features/scratchpad/server/scratchpad'
import { MAX_SCRATCHPAD_LENGTH } from '@/features/scratchpad/limits'

const schema = z.object({
  content: z.string().max(MAX_SCRATCHPAD_LENGTH, 'Der Schmierzettel ist zu lang (höchstens 20 000 Zeichen).'),
  baseVersion: z.number().int().min(0),
})

/** Schmierzettel des Kontos */
export const GET = route('user', ({ user }) => json({ scratchpad: getScratchpad(user.id) }))

/** Schmierzettel speichern – mit der Version, auf der der Text beruht (409 bei Änderung auf einem anderen Gerät) */
export const PUT = route('user', async ({ req, user }) => {
  const body = await parseJson(req, schema, 256 * 1024)
  return json({ scratchpad: saveScratchpad(user.id, body) })
})
