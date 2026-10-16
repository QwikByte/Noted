import { cn } from './cn'

/** Kreis mit den Initialen eines Namens */
export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
  return (
    <span
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-text',
        className,
      )}
    >
      {initials || '?'}
    </span>
  )
}
