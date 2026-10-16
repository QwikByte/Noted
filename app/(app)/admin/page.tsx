import type { Metadata } from 'next'
import { requireAppUser } from '@/features/auth/server/page-auth'
import { AdminPage } from '@/features/admin/components/AdminPage'

export const metadata: Metadata = { title: 'Administration' }

export default async function Page() {
  await requireAppUser({ admin: true })
  return <AdminPage />
}
