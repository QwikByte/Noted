import { json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { reindexAttachment } from '@/features/attachments/server/index'

/** Text einer Datei für die Volltextsuche erneut auslesen */
export const POST = route<{ id: string }>('user', async ({ user, params }) =>
  json({ search: await reindexAttachment(user.id, params.id) }),
)
