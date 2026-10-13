'use client'
import { createContext, useContext, useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '../ui/toast'
import { UpdateBanner } from './UpdateBanner'
import { NetworkError, setApiUser } from '@/lib/client/api'
import { sync } from '@/lib/client/sync'
import { startUpdateWatcher } from '@/lib/client/app-update'
import { applyTheme, type Theme } from '@/lib/client/prefs'
import type { PublicUser } from '@/lib/shared/types'

const UserContext = createContext<PublicUser | null>(null)

export function useUser(): PublicUser {
  const user = useContext(UserContext)
  if (!user) throw new Error('useUser außerhalb von AppProviders')
  return user
}

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
    startUpdateWatcher()
    // Systemeinstellung „Dunkel“ live übernehmen
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme((localStorage.getItem('noted:theme') as Theme | null) ?? 'system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [user.id])

  return (
    <UserContext.Provider value={user}>
      <QueryClientProvider client={client}>
        <ToastProvider sticky={<UpdateBanner />}>{children}</ToastProvider>
      </QueryClientProvider>
    </UserContext.Provider>
  )
}
