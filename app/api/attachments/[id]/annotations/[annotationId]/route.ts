import { json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { deleteAnnotation } from '@/features/pdf/server/annotations'

export const DELETE = route<{ id: string; annotationId: string }>('user', ({ user, params }) => {
  deleteAnnotation(user.id, params.id, params.annotationId)
  return json({ ok: true })
})
