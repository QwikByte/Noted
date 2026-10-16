'use client'
import 'pdfjs-dist/legacy/web/pdf_viewer.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Download,
  FileText,
  Layers,
  Link2,
  Loader2,
  Maximize2,
  Minimize2,
  MoreVertical,
  MoveHorizontal,
  Quote,
  Search,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { PDFDocumentLoadingTask } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { EventBus, PDFViewer } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs'
import { useApp } from '@/features/workspace/client/context'
import { Button } from '@/shared/ui/button'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/shared/ui/menu'
import { useToast } from '@/shared/ui/toast'
import { cn } from '@/shared/ui/cn'
import { defaultFileUrl } from '@/shared/markdown/obsidian'
import { getActiveEditor } from '@/features/notes/client/active-editor'
import { copyText } from '@/shared/client/clipboard'
import { attachmentsKey, useAttachments } from '@/features/attachments/client/queries'
import { niceFileName, uploadAttachment } from '@/features/attachments/client/upload'
import { errorMessage } from '@/shared/client/api'

type Lib = { pdfjs: typeof import('pdfjs-dist/legacy/build/pdf.mjs'); viewer: typeof import('pdfjs-dist/legacy/web/pdf_viewer.mjs') }
let lib: Promise<Lib> | null = null

/**
 * pdf.js erst laden, wenn wirklich ein PDF geöffnet wird. Der Viewer erwartet die Bibliothek als globalThis.pdfjsLib.
 * „legacy“-Build: läuft auch in Browsern, denen neueste JavaScript-Funktionen fehlen (z. B. ältere Handys).
 */
function loadPdfjs(): Promise<Lib> {
  lib ??= (async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs'
    const viewer = await import('pdfjs-dist/legacy/web/pdf_viewer.mjs')
    return { pdfjs, viewer }
  })()
  lib.catch(() => (lib = null))
  return lib
}

// Zuletzt gelesene Seite je PDF merken
const POS_KEY = 'noted:pdfpos'
function loadPositions(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(POS_KEY) ?? '{}')
  } catch {
    return {}
  }
}
function savePosition(file: string, page: number) {
  try {
    const all = loadPositions()
    delete all[file]
    all[file] = page
    const entries = Object.entries(all).slice(-50)
    localStorage.setItem(POS_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    /* egal */
  }
}

const AUTO_SCALES = new Set(['page-width', 'page-fit', 'auto'])
const baseName = (file: string) => file.split('/').pop()!.replace(/\.pdf$/i, '')

type Matches = { current: number; total: number }

export default function PdfPanel({
  file,
  page,
  nonce,
  full,
  onToggleFull,
  onClose,
  onOpen,
}: {
  file: string
  page?: number
  nonce: number
  full: boolean
  onToggleFull: () => void
  onClose: () => void
  onOpen: (file: string, page?: number) => void
}) {
  const app = useApp()
  const qc = useQueryClient()
  const toast = useToast()
  const { data: attachments = [] } = useAttachments()
  const pdfs = attachments.filter((a) => a.mime === 'application/pdf')

  const containerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<PDFViewer | null>(null)
  const busRef = useRef<EventBus | null>(null)
  const pendingPage = useRef<number | null>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const findRef = useRef<HTMLInputElement>(null)

  const [status, setStatus] = useState<{ state: 'loading' | 'ready' | 'error'; message?: string }>({ state: 'loading' })
  const [numPages, setNumPages] = useState(0)
  const [current, setCurrent] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const [scale, setScale] = useState(1)
  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<Matches | null>(null)
  const [selection, setSelection] = useState<{ text: string; page: number } | null>(null)

  // Dokument laden
  useEffect(() => {
    const container = containerRef.current
    const inner = innerRef.current
    if (!container || !inner) return
    let cancelled = false
    const ac = new AbortController()
    let task: PDFDocumentLoadingTask | null = null
    pendingPage.current = page ?? loadPositions()[file] ?? 1
    setStatus({ state: 'loading' })
    setSelection(null)
    setMatches(null)
    ;(async () => {
      try {
        const { pdfjs, viewer: V } = await loadPdfjs()
        // Ganze Datei laden (statt Teilbereichen) – so landet sie im Offline-Cache des Service Workers
        const res = await fetch(defaultFileUrl(file), { credentials: 'same-origin', signal: ac.signal })
        if (!res.ok) throw new Error(res.status === 404 ? 'Die Datei wurde nicht gefunden.' : `Die Datei konnte nicht geladen werden (${res.status}).`)
        const data = new Uint8Array(await res.arrayBuffer())
        if (cancelled) return
        task = pdfjs.getDocument({
          data,
          enableXfa: false,
          cMapUrl: '/pdfjs/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: '/pdfjs/standard_fonts/',
          wasmUrl: '/pdfjs/wasm/',
          iccUrl: '/pdfjs/iccs/',
        })
        const doc = await task.promise
        if (cancelled) return
        inner.replaceChildren()
        const eventBus = new V.EventBus()
        const linkService = new V.PDFLinkService({ eventBus, externalLinkTarget: V.LinkTarget.BLANK, externalLinkRel: 'noopener noreferrer' })
        const findController = new V.PDFFindController({ eventBus, linkService })
        const viewer = new V.PDFViewer({
          container,
          viewer: inner,
          eventBus,
          linkService,
          findController,
          annotationMode: pdfjs.AnnotationMode.ENABLE,
          // Beim Schließen Beobachter und Listener des Viewers wieder entfernen (fehlt in den Typen)
          ...{ abortSignal: ac.signal },
        } as ConstructorParameters<typeof V.PDFViewer>[0])
        linkService.setViewer(viewer)
        eventBus.on('pagesinit', () => {
          viewer.currentScaleValue = 'page-width'
          const target = pendingPage.current
          pendingPage.current = null
          if (target && target > 1) viewer.currentPageNumber = Math.min(target, viewer.pagesCount)
        })
        eventBus.on('pagechanging', (e: { pageNumber: number }) => {
          setCurrent(e.pageNumber)
          setPageInput(String(e.pageNumber))
          savePosition(file, e.pageNumber)
        })
        eventBus.on('scalechanging', (e: { scale: number }) => setScale(e.scale))
        eventBus.on('updatefindmatchescount', (e: { matchesCount: Matches }) => setMatches(e.matchesCount))
        eventBus.on('updatefindcontrolstate', (e: { matchesCount: Matches }) => setMatches(e.matchesCount))
        viewer.setDocument(doc)
        linkService.setDocument(doc)
        viewerRef.current = viewer
        busRef.current = eventBus
        setNumPages(doc.numPages)
        setCurrent(1)
        setPageInput('1')
        setStatus({ state: 'ready' })
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return
        setStatus({ state: 'error', message: errorMessage(err) })
      }
    })()
    return () => {
      cancelled = true
      ac.abort()
      viewerRef.current = null
      busRef.current = null
      void task?.destroy()
    }
    // Seite wird separat angesprungen (siehe unten)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  // Seite anspringen (z. B. Klick auf [[Skript.pdf#page=12]], während das PDF schon offen ist)
  useEffect(() => {
    const viewer = viewerRef.current
    if (!page) return
    if (viewer?.pagesCount) viewer.currentPageNumber = Math.min(page, viewer.pagesCount)
    else pendingPage.current = page
  }, [page, nonce])

  // Breite/Höhe des Panels ändert sich (Teilen, Ziehen, Drehen) → wieder auf Seitenbreite einpassen
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const ro = new ResizeObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const v = viewerRef.current
        if (v?.pagesCount && AUTO_SCALES.has(v.currentScaleValue)) v.currentScaleValue = v.currentScaleValue
      }, 120)
    })
    ro.observe(container)
    return () => {
      ro.disconnect()
      clearTimeout(timer)
    }
  }, [])

  // Zoomen mit Strg + Mausrad und mit zwei Fingern
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !viewerRef.current) return
      e.preventDefault()
      viewerRef.current.updateScale({ steps: e.deltaY < 0 ? 1 : -1, origin: [e.clientX, e.clientY], drawingDelay: 300 })
    }
    let pinch: { dist: number; applied: number } | null = null
    const distance = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) pinch = { dist: distance(e.touches), applied: 1 }
    }
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2 || !viewerRef.current) return
      e.preventDefault()
      const ratio = distance(e.touches) / pinch.dist
      if (Math.abs(ratio / pinch.applied - 1) < 0.04) return
      const origin: [number, number] = [
        (e.touches[0].clientX + e.touches[1].clientX) / 2,
        (e.touches[0].clientY + e.touches[1].clientY) / 2,
      ]
      viewerRef.current.updateScale({ scaleFactor: ratio / pinch.applied, origin, drawingDelay: 400 })
      pinch.applied = ratio
    }
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null
    }
    container.addEventListener('wheel', onWheel, { passive: false })
    container.addEventListener('touchstart', onTouchStart, { passive: true })
    container.addEventListener('touchmove', onTouchMove, { passive: false })
    container.addEventListener('touchend', onTouchEnd)
    return () => {
      container.removeEventListener('wheel', onWheel)
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchmove', onTouchMove)
      container.removeEventListener('touchend', onTouchEnd)
    }
  }, [])

  // Markierter Text im PDF → Aktionen (Zitat, Karteikarte, Kopieren)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onChange = () => {
      clearTimeout(timer)
      const sel = document.getSelection()
      const container = containerRef.current
      if (!sel || sel.isCollapsed) {
        // Etwas verzögert, damit ein Tipp auf die Aktionen (auf dem Handy hebt er die Markierung auf) noch ankommt
        timer = setTimeout(() => setSelection(null), 400)
        return
      }
      if (!container || !sel.anchorNode || !container.contains(sel.anchorNode)) {
        setSelection(null)
        return
      }
      const text = sel.toString().replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim()
      const pageEl = (sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode.parentElement)?.closest<HTMLElement>('.page')
      const pageNo = Number(pageEl?.dataset.pageNumber) || viewerRef.current?.currentPageNumber || 1
      setSelection(text ? { text, page: pageNo } : null)
    }
    document.addEventListener('selectionchange', onChange)
    return () => {
      document.removeEventListener('selectionchange', onChange)
      clearTimeout(timer)
    }
  }, [])

  const find = useCallback((type: '' | 'again', previous = false) => {
    busRef.current?.dispatch('find', {
      source: null,
      type,
      query: findRef.current?.value ?? '',
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: previous,
      matchDiacritics: false,
    })
  }, [])

  const closeFind = () => {
    setFindOpen(false)
    setQuery('')
    setMatches(null)
    busRef.current?.dispatch('find', { source: null, type: '', query: '', highlightAll: false })
  }

  const goTo = (n: number) => {
    const v = viewerRef.current
    if (!v?.pagesCount) return
    v.currentPageNumber = Math.max(1, Math.min(v.pagesCount, n))
  }

  /** Text in die geöffnete Notiz einfügen – ohne offene Notiz eine neue anlegen. */
  function insert(text: string, what: string) {
    const editor = getActiveEditor()
    if (editor) {
      editor.insert(text)
      toast.success(`${what} in „${editor.title}“ eingefügt.`)
      return
    }
    toast.show('Öffne zuerst eine Notiz, um etwas einzufügen.', {
      action: { label: 'Neue Notiz', onClick: () => void app.createNote({ title: baseName(file), folderId: null, content: text + '\n' }) },
    })
  }

  const pageLink = (n: number, label?: string) => `[[${file}#page=${n}${label ? `|${label}` : ''}]]`

  async function upload(files: File[]) {
    const f = files[0]
    if (!f) return
    try {
      toast.show(`Lade „${f.name}“ hoch …`)
      const att = await uploadAttachment(f, niceFileName(f))
      await qc.invalidateQueries({ queryKey: attachmentsKey })
      onOpen(att.filename)
    } catch (err) {
      toast.error(`Upload fehlgeschlagen: ${errorMessage(err)}`)
    }
  }

  const ready = status.state === 'ready'

  return (
    <section className="@container flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-subtle" aria-label={`PDF: ${file}`} data-testid="pdf-panel">
      {/* Werkzeugleiste – passt sich der Breite des Panels an */}
      <div className="flex h-12 min-w-0 shrink-0 items-center gap-0.5 border-b border-border bg-bg px-1.5">
        <div className="min-w-0 flex-1">
          <Menu
            align="left"
            className="max-h-[60vh] w-72 overflow-y-auto"
            trigger={(p) => (
              <button
                type="button"
                className="flex max-w-full min-w-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium hover:bg-hover"
                title={file}
                {...p}
              >
                <FileText className="size-4 shrink-0 text-danger" />
                <span className="truncate">{baseName(file)}</span>
                <ChevronDown className="size-3.5 shrink-0 text-faint" />
              </button>
            )}
          >
            <MenuLabel>PDFs</MenuLabel>
            {pdfs.length === 0 ? <p className="px-2.5 py-1.5 text-sm text-muted">Noch keine PDFs hochgeladen.</p> : null}
            {pdfs.map((a) => (
              <MenuItem key={a.id} icon={<FileText />} onSelect={() => onOpen(a.filename)}>
                <span className={cn('block truncate', a.filename === file && 'font-semibold')}>{a.filename}</span>
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem icon={<Upload />} onSelect={() => uploadRef.current?.click()}>
              PDF hochladen …
            </MenuItem>
          </Menu>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <div className="flex items-center @max-sm:hidden">
            <Button variant="ghost" size="icon-sm" onClick={() => goTo(current - 1)} disabled={!ready || current <= 1} aria-label="Vorherige Seite">
              <ChevronLeft className="size-4" />
            </Button>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                goTo(Number(pageInput) || current)
              }}
              className="flex items-center gap-1 text-xs text-muted"
            >
              <input
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ''))}
                onBlur={() => setPageInput(String(current))}
                inputMode="numeric"
                aria-label="Seite"
                className="h-7 w-9 rounded-md border border-border bg-elevated text-center text-xs text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
              <span className="whitespace-nowrap">/ {numPages || '–'}</span>
            </form>
            <Button variant="ghost" size="icon-sm" onClick={() => goTo(current + 1)} disabled={!ready || current >= numPages} aria-label="Nächste Seite">
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <div className="mx-0.5 h-5 w-px bg-border @max-2xl:hidden" />
          <Button variant="ghost" size="icon-sm" onClick={() => viewerRef.current?.decreaseScale()} disabled={!ready} aria-label="Verkleinern" className="@max-2xl:hidden">
            <ZoomOut className="size-4" />
          </Button>
          <button
            type="button"
            onClick={() => {
              if (viewerRef.current) viewerRef.current.currentScaleValue = 'page-width'
            }}
            disabled={!ready}
            className="h-7 rounded-md px-1 text-xs text-muted tabular-nums hover:bg-hover hover:text-fg @max-xl:hidden"
            title="Auf Seitenbreite einpassen"
          >
            {Math.round(scale * 100)} %
          </button>
          <Button variant="ghost" size="icon-sm" onClick={() => viewerRef.current?.increaseScale()} disabled={!ready} aria-label="Vergrößern" className="@max-2xl:hidden">
            <ZoomIn className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              setFindOpen((o) => !o)
              setTimeout(() => findRef.current?.focus(), 0)
            }}
            disabled={!ready}
            aria-label="Im PDF suchen"
            aria-pressed={findOpen}
          >
            <Search className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => insert(pageLink(current), `Link auf Seite ${current}`)}
            disabled={!ready}
            aria-label="Seite in Notiz verlinken"
            title="Link auf diese Seite in die Notiz einfügen"
            className="@max-md:hidden"
          >
            <Link2 className="size-4" />
          </Button>
          <Menu
            trigger={(p) => (
              <Button variant="ghost" size="icon-sm" aria-label="Weitere PDF-Aktionen" {...p}>
                <MoreVertical className="size-4" />
              </Button>
            )}
          >
            <MenuItem icon={<ZoomIn />} onSelect={() => viewerRef.current?.increaseScale()} disabled={!ready}>
              Vergrößern
            </MenuItem>
            <MenuItem icon={<ZoomOut />} onSelect={() => viewerRef.current?.decreaseScale()} disabled={!ready}>
              Verkleinern
            </MenuItem>
            <MenuItem
              icon={<MoveHorizontal />}
              onSelect={() => {
                if (viewerRef.current) viewerRef.current.currentScaleValue = 'page-width'
              }}
              disabled={!ready}
            >
              Seitenbreite
            </MenuItem>
            <MenuItem
              icon={<Maximize2 />}
              onSelect={() => {
                if (viewerRef.current) viewerRef.current.currentScaleValue = 'page-fit'
              }}
              disabled={!ready}
            >
              Ganze Seite
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Link2 />} onSelect={() => insert(pageLink(current), `Link auf Seite ${current}`)} disabled={!ready}>
              Seite {current} in Notiz verlinken
            </MenuItem>
            <MenuItem
              icon={<Copy />}
              onSelect={async () => {
                if (await copyText(pageLink(current))) toast.success('Link kopiert.')
              }}
              disabled={!ready}
            >
              Link auf Seite kopieren
            </MenuItem>
            <MenuItem
              icon={<Download />}
              onSelect={() => {
                const a = document.createElement('a')
                a.href = `${defaultFileUrl(file)}?download=1`
                a.click()
              }}
            >
              Herunterladen
            </MenuItem>
          </Menu>
          <Button variant="ghost" size="icon-sm" onClick={onToggleFull} aria-label={full ? 'Neben der Notiz anzeigen' : 'Vollbild'} title={full ? 'Geteilte Ansicht' : 'Vollbild'}>
            {full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="PDF schließen" title="Schließen">
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {findOpen ? (
        <div className="flex items-center gap-1 border-b border-border bg-bg px-2 py-1">
          <input
            ref={findRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setTimeout(() => find(''), 0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                find('again', e.shiftKey)
              } else if (e.key === 'Escape') closeFind()
            }}
            placeholder="Im PDF suchen …"
            aria-label="Im PDF suchen"
            className="h-7 min-w-0 flex-1 rounded-md border border-border bg-elevated px-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <span className="w-16 text-center text-xs text-muted tabular-nums">
            {query && matches ? (matches.total ? `${matches.current} / ${matches.total}` : 'Keine') : ''}
          </span>
          <Button variant="ghost" size="icon-sm" onClick={() => find('again', true)} aria-label="Vorheriger Treffer">
            <ChevronUp className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => find('again')} aria-label="Nächster Treffer">
            <ChevronDown className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={closeFind} aria-label="Suche schließen">
            <X className="size-4" />
          </Button>
        </div>
      ) : null}

      {/* Seiten (pdf.js braucht einen absolut positionierten Container) */}
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="pdf-container absolute inset-0 overflow-auto" tabIndex={0}>
          <div ref={innerRef} className="pdfViewer" />
        </div>
        {status.state !== 'ready' ? (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted">
            {status.state === 'loading' ? (
              <Loader2 className="size-6 animate-spin" />
            ) : (
              <div className="space-y-3">
                <FileText className="mx-auto size-8 text-faint" />
                <p>{status.message}</p>
                <Button size="sm" onClick={onClose}>
                  Schließen
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Aktionen für markierten Text */}
      {selection ? (
        <div className="flex items-center gap-1 border-t border-border bg-bg px-2 py-1.5" data-testid="pdf-selection">
          <span className="min-w-0 flex-1 truncate text-xs text-muted" title={selection.text}>
            „{selection.text}“
          </span>
          <Button
            size="sm"
            variant="ghost"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              insert(
                `${selection.text
                  .split('\n')
                  .map((l) => `> ${l}`)
                  .join('\n')}\n> ${pageLink(selection.page, `S. ${selection.page}`)}`,
                'Zitat',
              )
            }
          >
            <Quote className="size-4" /> <span className="@max-md:hidden">Zitieren</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              app.openCardEditor({
                back: `${selection.text}\n\n${pageLink(selection.page, `${baseName(file)}, S. ${selection.page}`)}`,
                noteId: getActiveEditor()?.noteId ?? null,
                deckName: baseName(file),
              })
            }
          >
            <Layers className="size-4" /> <span className="@max-md:hidden">Karteikarte</span>
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onMouseDown={(e) => e.preventDefault()}
            onClick={async () => {
              if (await copyText(selection.text)) toast.success('Kopiert.')
            }}
            aria-label="Kopieren"
          >
            <Copy className="size-4" />
          </Button>
        </div>
      ) : null}

      <input
        ref={uploadRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          void upload(files)
        }}
      />
    </section>
  )
}
