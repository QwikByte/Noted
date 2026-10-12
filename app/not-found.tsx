import Link from 'next/link'
import { Logo } from '@/components/Logo'

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-subtle px-6 text-center">
      <Logo className="size-12" />
      <h1 className="text-2xl font-bold">Seite nicht gefunden</h1>
      <p className="text-muted">Diese Adresse gibt es in Noted nicht.</p>
      <Link href="/" className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover">
        Zu den Notizen
      </Link>
    </main>
  )
}
