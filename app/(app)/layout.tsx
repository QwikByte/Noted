import { requireAppUser, toPublicUser } from '@/lib/server/page-auth'
import { AppProviders } from '@/components/app/AppProviders'

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const user = await requireAppUser()
  return <AppProviders user={toPublicUser(user)}>{children}</AppProviders>
}
