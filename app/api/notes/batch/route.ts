import { z } from 'zod'
import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { batchNotes } from '@/features/notes/server/notes'
import { NOTE_BATCH_ACTIONS } from '@/features/notes/types'
import { MAX_BATCH_NOTES } from '@/features/notes/limits'

const schema = z.object({
  action: z.enum(NOTE_BATCH_ACTIONS),
  ids: z.array(z.string().uuid()).min(1).max(MAX_BATCH_NOTES),
})

/** Mehrere Notizen auf einmal in den Papierkorb, zurück, endgültig löschen, anheften oder lösen */
export const POST = route('user', async ({ req, user }) => {
  const body = await parseJson(req, schema, 64 * 1024)
  return json(batchNotes(user.id, body.action, body.ids))
})
