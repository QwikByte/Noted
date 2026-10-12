import type { Metadata } from 'next'
import { requireAppUser } from '@/lib/server/page-auth'
import { AdminPage } from '@/components/admin/AdminPage'

export const metadata: Metadata = { title: 'Administration' }

export default async function Page() {
  await requireAppUser({ admin: true })
  return <AdminPage />
}
