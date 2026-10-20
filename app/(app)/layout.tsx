import { requireAppUser } from '@/features/auth/server/page-auth'
import { toPublicUser } from '@/features/auth/server/users'
import { AppProviders } from '@/features/workspace/components/AppProviders'
import { getConfig } from '@/shared/server/config'

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const user = await requireAppUser()
  return (
    <AppProviders user={toPublicUser(user)} sharing={getConfig().sharing}>
      {children}
    </AppProviders>
  )
}
