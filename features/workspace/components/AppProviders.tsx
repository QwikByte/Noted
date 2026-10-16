'use client'
import { useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/shared/ui/toast'
import { UpdateBanner } from '@/features/updates/components/UpdateBanner'
import { GlobalToolbar } from './GlobalToolbar'
import { NetworkError, setApiUser } from '@/shared/client/api'
import { sync } from '@/features/notes/client/sync'
import { reviewQueue } from '@/features/flashcards/client/flashcards'
import { startUpdateWatcher } from '@/features/updates/client/app-update'
import { applyTheme, type Theme } from '@/shared/client/prefs'
import { UserProvider } from '@/features/auth/client/current-user'
import type { PublicUser } from '@/features/auth/types'

export function AppProviders({ user, children }: { user: PublicUser; children: React.ReactNode }) {
  const [client] = useState(() => {
    setApiUser(user.id)
    return new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 30_000,
          refetchOnWindowFocus: true,
          retry: (count, err) => !(err instanceof NetworkError) && count < 2,
          networkMode: 'always',
        },
        mutations: { networkMode: 'always' },
      },
    })
  })

  useEffect(() => {
    sync.start(user.id)
    reviewQueue.start(user.id, client)
    startUpdateWatcher()
    // Systemeinstellung „Dunkel“ live übernehmen
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme((localStorage.getItem('noted:theme') as Theme | null) ?? 'system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [user.id, client])

  return (
    <UserProvider user={user}>
      <QueryClientProvider client={client}>
        <ToastProvider sticky={<UpdateBanner />}>
          {children}
          <GlobalToolbar />
        </ToastProvider>
      </QueryClientProvider>
    </UserProvider>
  )
}
