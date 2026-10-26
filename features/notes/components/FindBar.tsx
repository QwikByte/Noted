'use client'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { Button } from '@/shared/ui/button'

/** Leiste über dem Blatt: Fundstellen aus der Volltextsuche der Reihe nach ansehen */
export function FindBar({
  terms,
  index,
  count,
  onPrev,
  onNext,
  onClose,
}: {
  terms: string
  index: number
  count: number
  onPrev: () => void
  onNext: () => void
  onClose: () => void
}) {
  return (
    <div className="flex items-center gap-1 border-b border-border bg-subtle px-3 py-1 text-sm" data-testid="find-bar">
      <Search className="size-4 shrink-0 text-faint" />
      <span className="ml-1 min-w-0 flex-1 truncate">
        {count === 1 ? '1 Treffer' : `Treffer ${index + 1} von ${count}`} für „{terms}“
      </span>
      <Button variant="ghost" size="icon-sm" onClick={onPrev} disabled={count < 2} aria-label="Vorheriger Treffer" title="Vorheriger Treffer">
        <ChevronUp className="size-4" />
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={onNext} disabled={count < 2} aria-label="Nächster Treffer" title="Nächster Treffer">
        <ChevronDown className="size-4" />
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Markierung entfernen" title="Markierung entfernen (Esc)">
        <X className="size-4" />
      </Button>
    </div>
  )
}
