import { z } from 'zod'
import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { moveNoteIntoVault, moveNoteOutOfVault } from '@/features/notes/server/notes'

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('move-in'),
    folderId: z.string().uuid(),
    baseVersion: z.number().int(),
    titleEnc: z.string(),
    content: z.string(),
    /** Karteikarten aus der Notiz mitlöschen statt sie nur von ihr zu lösen */
    deleteCards: z.boolean().default(false),
  }),
  z.object({
    action: z.literal('move-out'),
    folderId: z.string().uuid().nullable(),
    baseVersion: z.number().int(),
    title: z.string().max(300),
    content: z.string(),
  }),
])

/** Notiz in den Tresor (verschlüsselt) oder heraus (entschlüsselt) verschieben – nur über diesen Weg */
export const POST = route<{ id: string }>('user', async ({ req, user, ip, params }) => {
  const body = await parseJson(req, schema)
  return json(
    body.action === 'move-in'
      ? moveNoteIntoVault({ user, ip }, params.id, body)
      : moveNoteOutOfVault({ user, ip }, params.id, body),
  )
})
