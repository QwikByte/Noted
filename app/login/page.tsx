import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getPageSession } from '@/features/auth/server/page-auth'
import { pendingSetup } from '@/features/auth/server/users'
import { LoginForm } from '@/features/auth/components/LoginForm'
import { AuthShell } from '@/features/auth/components/AuthShell'
import { safeRedirectPath as safeNext } from '@/features/auth/redirect'

export const metadata: Metadata = { title: 'Anmelden' }


export default async function LoginPage(props: PageProps<'/login'>) {
  const { next } = await props.searchParams
  const found = await getPageSession()
  if (found?.session.stage === 'full') redirect(pendingSetup(found.user) ? '/setup' : safeNext(next))
  return (
    <AuthShell>
      <LoginForm next={safeNext(next)} mfaPending={found?.session.stage === 'mfa'} />
    </AuthShell>
  )
}
