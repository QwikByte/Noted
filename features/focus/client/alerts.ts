'use client'
import { useEffect } from 'react'
import { useToast } from '@/shared/ui/toast'
import { onFocusEnd } from './focus-timer'
import { focusSessions } from './sessions'

/** Meldung in der App, wenn eine Phase vorbei ist – nach einer Fokus-Runde mit „Zählen“ */
export function useFocusAlerts() {
  const toast = useToast()
  useEffect(
    () =>
      onFocusEnd(({ title, body, endedAt }) => {
        const session = focusSessions.pendingEndingAt(endedAt)
        toast.show(`${title} – ${body}`, {
          tone: 'success',
          duration: 8000,
          action: session ? { label: 'Zählen', onClick: () => focusSessions.confirm(session.id) } : undefined,
        })
      }),
    [toast],
  )
}
