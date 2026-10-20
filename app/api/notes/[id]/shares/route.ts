import { z } from 'zod'
import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { createShare, listShares, publicOrigin } from '@/features/sharing/server/shares'

/** Gültige Links auf diese Notiz */
export const GET = route<{ id: string }>('user', ({ user, params }) => json({ shares: listShares(user.id, { noteId: params.id }) }))

const schema = z.object({ expiresInDays: z.union([z.literal(7), z.literal(30), z.null()]) })

/** Link zum Lesen erstellen – die Adresse mit dem Token steht nur in dieser Antwort */
export const POST = route<{ id: string }>('user', async ({ req, user, ip, params }) => {
  const { expiresInDays } = await parseJson(req, schema, 1024)
  return json(createShare({ user, ip }, params.id, expiresInDays, publicOrigin(req)), { status: 201 })
})
