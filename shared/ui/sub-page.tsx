// Bausteine für Unterseiten wie Einstellungen und Administration
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export function SubPageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="pt-safe sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center gap-2 px-3 py-2.5 sm:px-6">
        <Link href="/" className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-fg" aria-label="Zurück zu den Notizen">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="flex-1 text-lg font-semibold">{title}</h1>
        {children}
      </div>
    </header>
  )
}

export function Section({
  title,
  description,
  children,
  id,
}: {
  title: string
  description?: React.ReactNode
  children: React.ReactNode
  id?: string
}) {
  return (
    <section id={id} className="scroll-mt-6 rounded-xl border border-border bg-elevated p-5 sm:p-6">
      <div className="mb-5">
        <h2 className="font-semibold">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}
