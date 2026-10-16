import { json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { canRequestUpdate, readUpdateRequest, readUpdateStatus } from '@/features/updates/server/update-status'
import { BUILD } from '@/features/updates/build'
import type { SystemInfo } from '@/features/updates/types'

export const GET = route('admin', () => {
  const system: SystemInfo = {
    version: BUILD.version,
    commit: BUILD.commit,
    buildDate: BUILD.buildDate,
    node: process.version,
    update: readUpdateStatus(),
    canRequestUpdate: canRequestUpdate(),
    updateRequest: readUpdateRequest(),
  }
  return json({ system })
})
