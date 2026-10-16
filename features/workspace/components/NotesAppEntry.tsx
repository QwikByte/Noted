'use client'
import dynamic from 'next/dynamic'
import { Logo } from '@/shared/ui/logo'

function AppSkeleton() {
  return (
    <div className="flex h-dvh items-center justify-center bg-bg">
      <Logo className="size-12 animate-pulse" />
    </div>
  )
}

// Die Notiz-App läuft komplett im Browser (Editor, lokale Entwürfe, Offline-Betrieb)
const NotesApp = dynamic(() => import('./NotesApp'), { ssr: false, loading: AppSkeleton })

export function NotesAppEntry() {
  return <NotesApp />
}
