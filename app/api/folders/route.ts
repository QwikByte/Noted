import { z } from 'zod'
import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { createFolder, listFolders } from '@/features/notes/server/notes'
import { MAX_VAULT_TITLE_ENVELOPE_LENGTH } from '@/features/vault/limits'

export const GET = route('user', ({ user }) => json({ folders: listFolders(user.id) }))

const schema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().max(300),
  parentId: z.string().uuid().nullable().default(null),
  /** Nur im Tresor: verschlüsselter Name (dann ist `name` die ID oder leer) */
  nameEnc: z.string().max(MAX_VAULT_TITLE_ENVELOPE_LENGTH).optional(),
})

export const POST = route('user', async ({ req, user }) => {
  const body = await parseJson(req, schema)
  return json({ folder: createFolder(user.id, body) }, { status: 201 })
})
