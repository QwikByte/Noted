'use client'
import { createContext, useContext, useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '../ui/toast'
import { NetworkError } from '@/lib/client/api'
import { sync } from '@/lib/client/sync'
import { applyTheme, type Theme } from '@/lib/client/prefs'
import type { PublicUser } from '@/lib/shared/types'

const UserContext = createContext<PublicUser | null>(null)

export function useUser(): PublicUser {
  const user = useContext(UserContext)
  if (!user) throw new Error('useUser außerhalb von AppProviders')
  return user
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {})
}

export function AppProviders({ user, children }: { user: PublicUser; children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: true,
            retry: (count, err) => !(err instanceof NetworkError) && count < 2,
            networkMode: 'always',
          },
          mutations: { networkMode: 'always' },
        },
      }),
  )

  useEffect(() => {
    sync.start(user.id)
    registerServiceWorker()
    // Systemeinstellung „Dunkel“ live übernehmen
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme((localStorage.getItem('noted:theme') as Theme | null) ?? 'system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [user.id])

  return (
    <UserContext.Provider value={user}>
      <QueryClientProvider client={client}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    </UserContext.Provider>
  )
}
