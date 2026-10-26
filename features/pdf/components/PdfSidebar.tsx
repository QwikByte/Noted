'use client'
import { X } from 'lucide-react'
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import type { OutlineEntry } from '../navigation'
import PdfOutline from './PdfOutline'
import PdfThumbnails from './PdfThumbnails'

export type SidebarTab = 'outline' | 'pages'

const TABS: [SidebarTab, string][] = [
  ['outline', 'Inhalt'],
  ['pages', 'Seiten'],
]

/**
 * Seitenleiste „Inhalt und Seiten“ links neben den Seiten – aufgebaut wie die Liste der Anmerkungen rechts, bei
 * schmalem Panel liegt sie über den Seiten.
 */
export default function PdfSidebar({
  doc,
  outline,
  labels,
  current,
  tab,
  onTab,
  onOutline,
  onPage,
  onClose,
}: {
  doc: PDFDocumentProxy
  /** null: wird noch geladen */
  outline: OutlineEntry[] | null
  labels: string[] | null
  current: number
  tab: SidebarTab
  onTab: (tab: SidebarTab) => void
  onOutline: (entry: OutlineEntry) => void
  onPage: (page: number) => void
  onClose: () => void
}) {
  return (
    <aside
      className="flex w-72 shrink-0 flex-col border-r border-border bg-bg @max-2xl:absolute @max-2xl:inset-y-0 @max-2xl:left-0 @max-2xl:z-10 @max-2xl:w-[min(18rem,100%)] @max-2xl:shadow-lg"
      aria-label="Inhalt und Seiten"
      data-testid="pdf-navigation"
    >
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border pr-1 pl-1.5">
        <div className="flex flex-1 gap-0.5 rounded-lg bg-subtle p-0.5" role="tablist" aria-label="Navigation">
          {TABS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => onTab(value)}
              className={cn(
                'flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                tab === value ? 'bg-elevated text-fg shadow-sm' : 'text-muted hover:text-fg',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Inhalt und Seiten schließen">
          <X className="size-4" />
        </Button>
      </div>
      {tab === 'outline' ? (
        <PdfOutline entries={outline} labels={labels} current={current} onSelect={onOutline} />
      ) : (
        <PdfThumbnails doc={doc} labels={labels} current={current} onSelect={onPage} />
      )}
    </aside>
  )
}
