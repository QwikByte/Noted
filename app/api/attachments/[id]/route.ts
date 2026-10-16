import { json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { attachmentResponse, deleteAttachment, getAttachment } from '@/features/attachments/server/attachments'

export const GET = route<{ id: string }>('user', ({ req, user, params }) => {
  const att = getAttachment(user.id, params.id)
  return attachmentResponse(user.id, att, req.headers.get('range'), req.nextUrl.searchParams.get('download') === '1')
})

export const DELETE = route<{ id: string }>('user', ({ user, params }) => {
  deleteAttachment(user.id, params.id)
  return json({ ok: true })
})
