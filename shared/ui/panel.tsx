'use client'
import { cn } from './cn'

/** Kasten mit Überschrift, z. B. auf der Startseite (Termine, Karteikarten) */
export function Panel({
  title,
  actions,
  children,
  className,
  testId,
}: {
  title: string
  /** Knöpfe rechts in der Kopfzeile */
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
  testId?: string
}) {
  return (
    <section className={cn('rounded-xl border border-border bg-elevated p-4', className)} aria-label={title} data-testid={testId}>
      <div className="mb-3 flex min-h-8 items-center gap-2">
        <h2 className="flex-1 truncate font-semibold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  )
}
