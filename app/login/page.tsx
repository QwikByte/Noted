import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getPageSession } from '@/lib/server/page-auth'
import { pendingSetup } from '@/lib/server/users'
import { LoginForm } from '@/components/auth/LoginForm'
import { AuthShell } from '@/components/auth/AuthShell'

export const metadata: Metadata = { title: 'Anmelden' }

function safeNext(next: string | string[] | undefined): string {
  const value = Array.isArray(next) ? next[0] : next
  // Nur relative Pfade innerhalb der App zulassen (kein Open Redirect)
  return value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/'
}

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
