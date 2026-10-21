// Seitengerüst für die Ansichten im Hauptbereich (Notizen, Karteikarten, Dateien, Papierkorb)
import { cn } from './cn'

export function PageHeader({
  title,
  subtitle,
  actions,
  breadcrumb,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  breadcrumb?: React.ReactNode
}) {
  return (
    <div className="mb-7">
      {breadcrumb}
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-48">
          <h1 className="line-clamp-2 text-2xl leading-tight font-bold tracking-tight text-balance break-words sm:text-[1.75rem]">{title}</h1>
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
      {/* Beim Wechsel der Ansicht sanft einblenden statt hart umzuschalten */}
      <div className={cn('mx-auto w-full max-w-3xl animate-fade-in px-4 pt-6 pb-28 sm:px-8 sm:pt-10', className)}>{children}</div>
    </div>
  )
}
