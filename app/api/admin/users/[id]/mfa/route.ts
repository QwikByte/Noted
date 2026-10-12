import { json, route } from '@/lib/server/http'
import { adminResetMfa } from '@/lib/server/admin'

/** MFA zurücksetzen (z. B. bei verlorenem Handy) */
export const DELETE = route<{ id: string }>('admin', ({ user, ip, params }) => {
  adminResetMfa({ user, ip }, Number(params.id))
  return json({ ok: true })
})
