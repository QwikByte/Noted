'use client'
import { useState } from 'react'
import {
  BookA,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Hash,
  Home,
  Layers,
  Paperclip,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { useApp } from '../client/context'
import { FolderTree } from '@/features/notes/components/FolderTree'
import { UserMenu } from './UserMenu'
import { SyncBadge } from '@/features/notes/components/SyncBadge'
import { useDueTotal } from '@/features/flashcards/components/CardsView'
import { Logo } from '@/shared/ui/logo'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { useTags } from '@/features/notes/client/queries'
import { usePref } from '@/shared/client/prefs'

function NavItem({
  icon,
  label,
  active,
  onClick,
  count,
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  onClick: () => void
  count?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
        active ? 'bg-active font-semibold text-fg' : 'text-muted hover:bg-hover hover:text-fg',
      )}
    >
      <span className={cn('flex size-4 items-center justify-center [&>svg]:size-4', active && 'text-accent-text')}>{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {count ? (
        <span className="marker px-1.5 text-[11px] leading-[18px] font-semibold tabular-nums">{count}</span>
      ) : null}
    </button>
  )
}

export function Sidebar({ currentFolderId }: { currentFolderId: string | null }) {
  const app = useApp()
  const { view } = app
  const { data: tags = [] } = useTags()
  const due = useDueTotal()
  const [tagsOpen, setTagsOpen] = usePref<'1' | '0'>('noted:tagsOpen', '1')
  const [query, setQuery] = useState(view.kind === 'search' ? view.q : '')
  // Suchfeld leeren, sobald die Suche verlassen wird
  const [prevKind, setPrevKind] = useState(view.kind)
  if (prevKind !== view.kind) {
    setPrevKind(view.kind)
    if (view.kind !== 'search') setQuery('')
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Gleiche Höhe wie die Kopfzeile daneben, damit die Linien durchlaufen */}
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-4">
        <Logo className="size-6" />
        <span className="flex-1 text-base font-bold tracking-tight">Noted</span>
        <SyncBadge />
      </div>

      <div className="space-y-2 px-3 pt-3">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            app.go({ kind: 'search', q: query })
          }}
          className="relative"
        >
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Suchen …"
            aria-label="Notizen durchsuchen"
            className="h-9 w-full rounded-md border border-border bg-elevated pr-14 pl-9 text-sm outline-none placeholder:text-faint focus:border-accent focus:ring-3 focus:ring-accent/20"
          />
          <kbd className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded border border-border px-1.5 text-[10px] text-faint sm:block">
            Ctrl K
          </kbd>
        </form>
        <div className="flex gap-2">
          <Button variant="primary" size="sm" className="flex-1" onClick={() => app.openNewNote({ folderId: currentFolderId })}>
            <Plus className="size-4" /> Neue Notiz
          </Button>
          <Button size="icon-sm" onClick={() => app.openNewFolder(null)} aria-label="Neuer Ordner" title="Neuer Ordner">
            <FolderPlus className="size-4" />
          </Button>
        </div>
      </div>

      <nav className="mt-3 space-y-px px-2">
        <NavItem icon={<Home />} label="Start" active={view.kind === 'home'} onClick={() => app.go({ kind: 'home' })} />
        <NavItem
          icon={<CalendarDays />}
          label="Kalender"
          active={view.kind === 'calendar'}
          onClick={() => app.go({ kind: 'calendar' })}
        />
        <NavItem
          icon={<Layers />}
          label="Karteikarten"
          active={view.kind === 'cards' || view.kind === 'deck' || view.kind === 'study' || view.kind === 'stats'}
          onClick={() => app.go({ kind: 'cards' })}
          count={due}
        />
        <NavItem icon={<BookA />} label="Glossar" active={view.kind === 'glossary'} onClick={() => app.go({ kind: 'glossary' })} />
        <NavItem icon={<Paperclip />} label="Anhänge" active={view.kind === 'files'} onClick={() => app.go({ kind: 'files' })} />
        <NavItem icon={<Trash2 />} label="Papierkorb" active={view.kind === 'trash'} onClick={() => app.go({ kind: 'trash' })} />
      </nav>

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <div className="mb-1 px-2.5 text-xs font-semibold text-faint">Notizen</div>
        <FolderTree />

        {tags.length > 0 ? (
          <div className="mt-5">
            <button
              type="button"
              onClick={() => setTagsOpen(tagsOpen === '1' ? '0' : '1')}
              className="flex w-full items-center gap-1 px-2.5 pb-1 text-xs font-semibold text-faint hover:text-muted"
            >
              {tagsOpen === '1' ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              Tags
            </button>
            {tagsOpen === '1' ? (
              <div className="flex flex-wrap gap-1.5 px-2 pt-1">
                {tags.map((t) => (
                  <button
                    key={t.tag}
                    type="button"
                    onClick={() => app.go({ kind: 'tag', tag: t.tag })}
                    className={cn(
                      'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs transition-colors',
                      view.kind === 'tag' && view.tag === t.tag
                        ? 'bg-accent text-on-accent'
                        : 'bg-accent-soft text-accent-text hover:bg-active',
                    )}
                  >
                    <Hash className="size-3" />
                    {t.tag}
                    <span className="opacity-60">{t.count}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="pb-safe border-t border-border">
        <div className="p-2">
          <UserMenu />
        </div>
      </div>
    </div>
  )
}
