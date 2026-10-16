// Seitengerüst für die Ansichten im Hauptbereich (Notizen, Karteikarten, Dateien, Papierkorb)
import { cn } from './cn'

export function PageHeader({
  title,
  subtitle,
  icon,
  actions,
  breadcrumb,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  icon?: React.ReactNode
  actions?: React.ReactNode
  breadcrumb?: React.ReactNode
}) {
  return (
    <div className="mb-7">
      {breadcrumb}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="flex min-w-0 items-center gap-2.5 text-[1.75rem] leading-tight font-bold tracking-tight">
            {icon ? <span className="shrink-0 text-faint [&>svg]:size-6">{icon}</span> : null}
            <span className="truncate">{title}</span>
          </h1>
          {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 gap-2 pt-1">{actions}</div> : null}
      </div>
    </div>
  )
}

export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className={cn('mx-auto w-full max-w-3xl px-4 pt-6 pb-28 sm:px-8 sm:pt-10', className)}>{children}</div>
    </div>
  )
}
