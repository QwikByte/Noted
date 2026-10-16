'use client'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/shared/client/api'
import type { Attachment } from '../types'

export const attachmentsKey = ['attachments'] as const

export function useAttachments() {
  return useQuery({
    queryKey: attachmentsKey,
    queryFn: () => api<{ attachments: Attachment[] }>('/api/attachments').then((r) => r.attachments),
  })
}
