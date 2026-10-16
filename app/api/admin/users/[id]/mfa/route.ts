import { json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { adminResetMfa } from '@/features/admin/server/admin'

/** MFA zurücksetzen (z. B. bei verlorenem Handy) */
export const DELETE = route<{ id: string }>('admin', ({ user, ip, params }) => {
  adminResetMfa({ user, ip }, Number(params.id))
  return json({ ok: true })
})
