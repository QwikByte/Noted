'use client'
// Glossar und Formelsammlung: Definitionen und LaTeX-Formeln aus den Notizen eines Ordners (oder aller Notizen)
import { useMemo, useState } from 'react'
import { Copy, Download, FileText, Loader2, MoreVertical, Printer, Search } from 'lucide-react'
import { useApp } from '@/features/workspace/client/context'
import type { View } from '@/features/workspace/client/nav'
import { useFolders } from '@/features/notes/client/queries'
import { folderPath } from '@/features/notes/tree'
import { CardMarkdown } from '@/features/flashcards/components/CardMarkdown'
import { Page, PageHeader } from '@/shared/ui/page-layout'
import { Button } from '@/shared/ui/button'
import { Select } from '@/shared/ui/input'
import { Menu, MenuItem, useContextMenu } from '@/shared/ui/menu'
import { PrintOption, PrintView, usePrintShortcut } from '@/shared/ui/print-view'
import { useToast } from '@/shared/ui/toast'
import { cn } from '@/shared/ui/cn'
import { copyText } from '@/shared/client/clipboard'
import { usePref } from '@/shared/client/prefs'
import { errorMessage } from '@/shared/client/api'
import { useGlossary } from '../client/glossary'
import { glossaryToMarkdown, initialOf } from '../glossary'
import type { GlossaryFormula, GlossarySource, GlossaryTerm } from '../types'

type Tab = 'terms' | 'formulas'

const matches = (q: string, ...texts: (string | null)[]) => texts.some((t) => t?.toLowerCase().includes(q))

/** Fundstelle eines Eintrags: die Notiz, mit Überschrift an dieser Stelle */
const sourceView = (source: GlossarySource): View => ({
  kind: 'note',
  id: source.noteId,
  heading: source.heading ?? undefined,
})

export function GlossaryView({ folder }: { folder?: string }) {
  const app = useApp()
  const toast = useToast()
  const { data: folders = [] } = useFolders()
  const { data, isLoading, error } = useGlossary(folder ?? null)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<Tab>('terms')
  const [printOpen, setPrintOpen] = useState(false)
  const openContextMenu = useContextMenu()

  const options = useMemo(
    () =>
      folders
        .map((f) => ({ id: f.id, label: folderPath(folders, f.id).map((p) => p.name).join(' / ') }))
        .sort((a, b) => a.label.localeCompare(b.label, 'de', { sensitivity: 'base', numeric: true })),
    [folders],
  )
  const scopeName = folder ? (options.find((o) => o.id === folder)?.label ?? 'Ordner') : 'Alle Notizen'

  const q = query.trim().toLowerCase()
  const terms = useMemo(
    () => (data?.terms ?? []).filter((t) => !q || matches(q, t.term, t.definition, t.noteTitle, t.heading)),
    [data, q],
  )
  const formulas = useMemo(
    () => (data?.formulas ?? []).filter((f) => !q || matches(q, f.tex, f.noteTitle, f.heading)),
    [data, q],
  )

  const markdown = () => glossaryToMarkdown(`Glossar – ${scopeName}`, terms, formulas)
  const empty = terms.length + formulas.length === 0
  usePrintShortcut(empty ? null : () => setPrintOpen(true))

  async function copy() {
    if (await copyText(markdown())) toast.success('Als Markdown kopiert.')
    else toast.error('Kopieren nicht möglich.')
  }

  function download() {
    const url = URL.createObjectURL(new Blob([markdown()], { type: 'text/markdown;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `Glossar – ${scopeName.replace(/[\\/:*?"<>|#^[\]]/g, '-')}.md`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  // Dieselben Einträge im Menü „…“ und beim Rechtsklick auf die freie Fläche
  const exportItems = (
    <>
      <MenuItem icon={<Copy />} onSelect={() => void copy()} disabled={empty}>
        Als Markdown kopieren
      </MenuItem>
      <MenuItem icon={<Download />} onSelect={download} disabled={empty}>
        Als .md herunterladen
      </MenuItem>
      <MenuItem icon={<Printer />} onSelect={() => setPrintOpen(true)} disabled={empty} hint="Strg+P">
        Drucken …
      </MenuItem>
    </>
  )

  return (
    <Page onContextMenu={(e) => openContextMenu(e, exportItems, { text: true, copy: true })}>
      <PageHeader
        title="Glossar und Formeln"
        actions={
          <Menu
            trigger={(p) => (
              <Button variant="ghost" size="icon-sm" aria-label="Glossar-Aktionen" {...p}>
                <MoreVertical className="size-4" />
              </Button>
            )}
          >
            {exportItems}
          </Menu>
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Select
          value={folder ?? ''}
          onChange={(e) => app.go({ kind: 'glossary', folder: e.target.value || undefined }, { replace: true })}
          aria-label="Notizen"
          className="sm:w-64"
        >
          <option value="">Alle Notizen</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Begriffe und Formeln durchsuchen …"
            aria-label="Glossar durchsuchen"
            className="h-11 w-full rounded-lg border border-border-strong/70 bg-elevated pr-3 pl-9 text-[15px] outline-none placeholder:text-faint focus:border-accent focus:ring-3 focus:ring-accent/20"
          />
        </div>
      </div>

      <div className="mb-5 flex rounded-xl bg-subtle p-1" role="tablist" aria-label="Glossar">
        {(
          [
            ['terms', 'Begriffe', terms.length],
            ['formulas', 'Formeln', formulas.length],
          ] as const
        ).map(([value, label, n]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              'flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              tab === value ? 'bg-elevated text-fg shadow-sm' : 'text-muted hover:text-fg',
            )}
          >
            {label} <span className="tabular-nums opacity-70">{data ? n : ''}</span>
          </button>
        ))}
      </div>

      {!data ? (
        isLoading ? (
          <Loader2 className="mx-auto size-6 animate-spin text-faint" />
        ) : (
          <p className="text-center text-sm text-muted">Das Glossar konnte nicht geladen werden. {errorMessage(error)}</p>
        )
      ) : (
        <>
          {data.truncated ? (
            <p className="mb-4 rounded-xl bg-warning-soft px-4 py-3 text-sm">
              Es gibt sehr viele Einträge – angezeigt werden nur die ersten. Wähle einen Ordner, um weniger zu sehen.
            </p>
          ) : null}
          {tab === 'terms' ? <Terms terms={terms} searching={!!q} /> : <Formulas formulas={formulas} searching={!!q} />}
        </>
      )}
      {printOpen ? (
        <GlossaryPrint scopeName={scopeName} query={query.trim()} terms={terms} formulas={formulas} onClose={() => setPrintOpen(false)} />
      ) : null}
    </Page>
  )
}

/** Druckansicht: was gerade zu sehen ist – gewählter Ordner und Suche; leere Abschnitte entfallen */
function GlossaryPrint({
  scopeName,
  query,
  terms,
  formulas,
  onClose,
}: {
  scopeName: string
  query: string
  terms: GlossaryTerm[]
  formulas: GlossaryFormula[]
  onClose: () => void
}) {
  const [showTerms, setShowTerms] = usePref<'1' | '0'>('noted:print:terms', '1')
  const [showFormulas, setShowFormulas] = usePref<'1' | '0'>('noted:print:formulas', '1')
  const [sources, setSources] = usePref<'1' | '0'>('noted:print:sources', '1')
  const [compact, setCompact] = usePref<'1' | '0'>('noted:print:compact', '0')
  const title = `Glossar – ${scopeName}`
  return (
    <PrintView
      title={title}
      heading={title}
      compact={compact === '1'}
      onClose={onClose}
      options={
        <>
          <PrintOption label="Begriffe" checked={showTerms === '1'} onChange={(v) => setShowTerms(v ? '1' : '0')} />
          <PrintOption label="Formeln" checked={showFormulas === '1'} onChange={(v) => setShowFormulas(v ? '1' : '0')} />
          <PrintOption label="Fundstellen" checked={sources === '1'} onChange={(v) => setSources(v ? '1' : '0')} />
          <PrintOption label="Kompakt" checked={compact === '1'} onChange={(v) => setCompact(v ? '1' : '0')} />
        </>
      }
    >
      {query ? <p className="print-meta">Suche: {query}</p> : null}
      {showTerms === '1' && terms.length > 0 ? (
        <section>
          <h2 className="print-heading">Begriffe</h2>
          <Terms terms={terms} searching={false} sources={sources === '1'} />
        </section>
      ) : null}
      {showFormulas === '1' && formulas.length > 0 ? (
        <section>
          <h2 className="print-heading">Formeln</h2>
          <Formulas formulas={formulas} searching={false} sources={sources === '1'} />
        </section>
      ) : null}
    </PrintView>
  )
}

function SourceLink({ source, withNote = true }: { source: GlossarySource; withNote?: boolean }) {
  const app = useApp()
  const label = [withNote ? source.noteTitle : null, source.heading].filter(Boolean).join(' › ')
  if (!label) return null
  return (
    <button
      type="button"
      onClick={() => app.go(sourceView(source))}
      className="inline-flex max-w-full items-center gap-1 text-xs text-muted hover:text-fg"
      title="In der Notiz zeigen"
    >
      <FileText className="size-3 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  )
}

function Empty({ searching, children }: { searching: boolean; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border-strong px-6 py-10 text-center text-sm text-muted">
      {searching ? <p>Nichts passt zur Suche.</p> : children}
    </div>
  )
}

/** `sources`: mit Fundstelle (Notiz › Überschrift) */
function Terms({ terms, searching, sources = true }: { terms: GlossaryTerm[]; searching: boolean; sources?: boolean }) {
  const app = useApp()
  const openContextMenu = useContextMenu()
  if (terms.length === 0) {
    return (
      <Empty searching={searching}>
        <p className="font-medium text-fg">Noch keine Definitionen</p>
        <p className="mx-auto mt-1 max-w-md">
          Aus <code>&gt; [!info] Begriff</code> und <code>**Begriff**: Erklärung</code> in deinen Notizen.
        </p>
      </Empty>
    )
  }
  const groups: { letter: string; items: GlossaryTerm[] }[] = []
  for (const t of terms) {
    const letter = initialOf(t.term)
    const last = groups[groups.length - 1]
    if (last?.letter === letter) last.items.push(t)
    else groups.push({ letter, items: [t] })
  }
  return (
    <div className="space-y-6" data-testid="glossary-terms">
      {groups.map((g) => (
        <section key={g.letter}>
          <h2 className="mb-2 border-b border-border pb-1 text-sm font-semibold text-faint">{g.letter}</h2>
          <dl className="space-y-4">
            {g.items.map((t, i) => (
              <div
                key={`${t.noteId}-${i}`}
                onContextMenu={(e) =>
                  openContextMenu(
                    e,
                    <MenuItem icon={<FileText />} onSelect={() => app.go(sourceView(t))}>
                      In der Notiz zeigen
                    </MenuItem>,
                    { text: true, copy: true },
                  )
                }
              >
                <dt>
                  <CardMarkdown text={t.term} className="font-semibold" />
                </dt>
                <dd className="mt-0.5 space-y-1">
                  <CardMarkdown text={t.definition} className="text-[0.9375rem]" />
                  {sources ? <SourceLink source={t} /> : null}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}

function Formulas({
  formulas,
  searching,
  sources = true,
}: {
  formulas: GlossaryFormula[]
  searching: boolean
  sources?: boolean
}) {
  const app = useApp()
  const openContextMenu = useContextMenu()
  if (formulas.length === 0) {
    return (
      <Empty searching={searching}>
        <p className="font-medium text-fg">Noch keine Formeln</p>
        <p className="mx-auto mt-1 max-w-md">
          Formeln als LaTeX-Block (<code>$$ … $$</code>) erscheinen hier.
        </p>
      </Empty>
    )
  }
  const groups: { noteId: string; title: string; items: GlossaryFormula[] }[] = []
  for (const f of formulas) {
    const last = groups[groups.length - 1]
    if (last?.noteId === f.noteId) last.items.push(f)
    else groups.push({ noteId: f.noteId, title: f.noteTitle, items: [f] })
  }
  return (
    <div className="space-y-6" data-testid="glossary-formulas">
      {groups.map((g) => (
        <section key={g.noteId}>
          <h2 className="mb-2 border-b border-border pb-1">
            <button
              type="button"
              onClick={() => app.go({ kind: 'note', id: g.noteId })}
              className="max-w-full text-left text-sm font-semibold break-words hover:underline"
            >
              {g.title}
            </button>
          </h2>
          <ul className="space-y-3">
            {g.items.map((f, i) => (
              <li
                key={i}
                className="rounded-xl border border-border bg-elevated px-4 py-2"
                onContextMenu={(e) =>
                  openContextMenu(
                    e,
                    <MenuItem icon={<FileText />} onSelect={() => app.go(sourceView(f))}>
                      In der Notiz zeigen
                    </MenuItem>,
                    { text: true, copy: true },
                  )
                }
              >
                {sources ? <SourceLink source={f} withNote={false} /> : null}
                <CardMarkdown text={`$$\n${f.tex}\n$$`} className="overflow-x-auto" />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
