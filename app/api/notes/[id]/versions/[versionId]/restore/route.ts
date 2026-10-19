import { json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { restoreVersion } from '@/features/notes/server/notes'
import { parseVersionId } from '@/features/notes/server/versions'

/** Älteren Stand wiederherstellen – der bisherige Stand bleibt im Verlauf */
export const POST = route<{ id: string; versionId: string }>('user', ({ user, params }) =>
  json(restoreVersion(user.id, params.id, parseVersionId(params.versionId))),
)
