import { json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { attachmentReferences } from '@/features/attachments/server/attachments'

/** Notizen, die auf die Datei verweisen – mit den zitierten Seiten (Rückverweise im PDF-Viewer) */
export const GET = route<{ id: string }>('user', ({ user, params }) => json({ notes: attachmentReferences(user.id, params.id) }))
