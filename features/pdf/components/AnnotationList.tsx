'use client'
import { Quote, Sparkles, X } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { annotationText } from './AnnotationBar'
import type { PdfAnnotation } from '../types'

/** Seitenleiste „Anmerkungen“ im PDF-Viewer – Markierungen in der Reihenfolge des Dokuments */
export default function AnnotationList({
  annotations,
  activeId,
  onSelect,
  onContextMenu,
  onInsertAll,
  onAiCards,
  onClose,
}: {
  /** Bereits sortiert (sortAnnotations) */
  annotations: PdfAnnotation[]
  activeId: string | null
  onSelect: (annotation: PdfAnnotation) => void
  /** Rechtsklick auf einen Eintrag: dieselben Aktionen wie auf der Markierung im PDF */
  onContextMenu: (e: React.MouseEvent, annotation: PdfAnnotation) => void
  onInsertAll: () => void
  /** Karteikarten mit KI aus allen Markierungen – nur, wenn die KI eingerichtet ist */
  onAiCards?: () => void
  onClose: () => void
}) {
  const pages = [...new Set(annotations.map((a) => a.page))]
  return (
    <aside
      className="flex w-72 shrink-0 flex-col border-l border-border bg-bg @max-2xl:absolute @max-2xl:inset-y-0 @max-2xl:right-0 @max-2xl:z-10 @max-2xl:w-[min(18rem,100%)] @max-2xl:shadow-lg"
      aria-label="Anmerkungen"
      data-testid="pdf-annotations"
    >
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border pr-1 pl-3">
        <span className="flex-1 text-sm font-medium">Anmerkungen</span>
        <span className="text-xs text-faint tabular-nums">{annotations.length || ''}</span>
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Anmerkungen schließen">
          <X className="size-4" />
        </Button>
      </div>
      {annotations.length === 0 ? (
        <p className="flex-1 p-4 text-sm text-muted">
          Noch keine Markierungen. Wähle Text im PDF aus und tippe auf „Markieren“ oder „Kommentieren“ – oder
          ziehe mit „Bereich markieren“ ein Rechteck über eine Formel, Abbildung oder einen Scan.
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {pages.map((page) => (
            <section key={page} aria-label={`Seite ${page}`}>
              <h3 className="px-2 pt-2 pb-1 text-xs font-medium text-faint">Seite {page}</h3>
              <ul>
                {annotations
                  .filter((a) => a.page === page)
                  .map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(a)}
                        onContextMenu={(e) => onContextMenu(e, a)}
                        aria-current={a.id === activeId ? 'true' : undefined}
                        className={cn(
                          'flex w-full gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-hover',
                          a.id === activeId && 'bg-active',
                        )}
                      >
                        <span className="w-1 shrink-0 self-stretch rounded-full" style={{ background: `var(--swatch-${a.color})` }} />
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 text-sm">{a.kind === 'area' ? annotationText(a) : a.quote}</span>
                          {a.comment ? <span className="mt-0.5 line-clamp-2 text-xs text-muted">{a.comment}</span> : null}
                        </span>
                      </button>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <div className="shrink-0 space-y-1.5 border-t border-border p-2">
        <Button size="sm" variant="secondary" className="w-full" onClick={onInsertAll} disabled={annotations.length === 0}>
          <Quote className="size-4" /> Alle als Zitate einfügen
        </Button>
        {onAiCards ? (
          <Button size="sm" variant="secondary" className="w-full" onClick={onAiCards} disabled={annotations.length === 0}>
            <Sparkles className="size-4" /> Karteikarten mit KI …
          </Button>
        ) : null}
      </div>
    </aside>
  )
}
