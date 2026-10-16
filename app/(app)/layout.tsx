import { requireAppUser } from '@/features/auth/server/page-auth'
import { toPublicUser } from '@/features/auth/server/users'
import { AppProviders } from '@/features/workspace/components/AppProviders'

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const user = await requireAppUser()
  return <AppProviders user={toPublicUser(user)}>{children}</AppProviders>
}
