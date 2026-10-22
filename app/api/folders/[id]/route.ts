import { z } from 'zod'
import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { deleteFolder, updateFolder } from '@/features/notes/server/notes'
import { MAX_VAULT_TITLE_ENVELOPE_LENGTH } from '@/features/vault/limits'

const schema = z.object({
  name: z.string().max(300).optional(),
  parentId: z.string().uuid().nullable().optional(),
  /** Nur im Tresor: verschlüsselter Name */
  nameEnc: z.string().max(MAX_VAULT_TITLE_ENVELOPE_LENGTH).optional(),
})

export const PATCH = route<{ id: string }>('user', async ({ req, user, params }) => {
  const body = await parseJson(req, schema)
  return json({ folder: updateFolder(user.id, params.id, body) })
})

export const DELETE = route<{ id: string }>('user', ({ user, params }) => {
  return json(deleteFolder(user.id, params.id))
})
