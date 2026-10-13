import { json, route } from '@/lib/server/http'
import { canRequestUpdate, readUpdateRequest, readUpdateStatus } from '@/lib/server/update-status'
import { BUILD } from '@/lib/shared/build'
import type { SystemInfo } from '@/lib/shared/types'

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
