import { json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { getVersion, parseVersionId } from '@/features/notes/server/versions'

export const GET = route<{ id: string; versionId: string }>('user', ({ user, params }) =>
  json({ version: getVersion(user.id, params.id, parseVersionId(params.versionId)) }),
)
