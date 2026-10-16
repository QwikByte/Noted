'use client'
import { createContext, useContext } from 'react'
import type { PublicUser } from '../types'

const UserContext = createContext<PublicUser | null>(null)

/** Stellt den angemeldeten Benutzer bereit (gesetzt von AppProviders). */
export function UserProvider({ user, children }: { user: PublicUser; children: React.ReactNode }) {
  return <UserContext.Provider value={user}>{children}</UserContext.Provider>
}

export function useUser(): PublicUser {
  const user = useContext(UserContext)
  if (!user) throw new Error('useUser außerhalb von AppProviders')
  return user
}
