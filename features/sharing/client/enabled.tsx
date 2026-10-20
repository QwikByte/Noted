'use client'
import { createContext, useContext } from 'react'

// SHARING=false schaltet das Teilen auf dem Server ab – dann zeigt die Oberfläche es gar nicht erst an
const SharingContext = createContext(false)

export function SharingProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  return <SharingContext.Provider value={enabled}>{children}</SharingContext.Provider>
}

export function useSharingEnabled(): boolean {
  return useContext(SharingContext)
}
