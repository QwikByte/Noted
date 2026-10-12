import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getPageSession } from '@/lib/server/page-auth'
import { isMfaRequired, pendingSetup } from '@/lib/server/users'
import { AuthShell } from '@/components/auth/AuthShell'
import { SetupFlow } from '@/components/auth/SetupFlow'

export const metadata: Metadata = { title: 'Konto einrichten' }

export default async function SetupPage() {
  const found = await getPageSession()
  if (!found || found.session.stage !== 'full') redirect('/login')
  const pending = pendingSetup(found.user)
  if (!pending) redirect('/')
  const user = found.user
  return (
    <AuthShell>
      <SetupFlow
        initialStep={pending}
        displayName={user.display_name || user.username}
        needsMfa={isMfaRequired(user) && !user.mfa_enabled}
      />
    </AuthShell>
  )
}
