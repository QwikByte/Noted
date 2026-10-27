'use client'
import Link from 'next/link'
import { Sparkles } from 'lucide-react'

/** Hinweis, wo man die KI einrichtet – wo eine KI-Funktion ohne hinterlegten Schlüssel auftaucht */
export function AiSetupHint({ what }: { what: string }) {
  return (
    <p className="flex items-start gap-2 text-sm text-muted">
      <Sparkles className="mt-0.5 size-4 shrink-0" />
      <span>
        {what}: Hinterlege dafür unter{' '}
        <Link href="/settings#ki" className="text-accent-text hover:underline">
          Einstellungen → KI
        </Link>{' '}
        deinen Anthropic-API-Schlüssel.
      </span>
    </p>
  )
}
