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
  Highlighter,
  ImageIcon,
  Layers,
  Link2,
  Loader2,
  Maximize2,
  MessageSquare,
  Minimize2,
  MoreVertical,
  MoveHorizontal,
  Quote,
  Search,
  Trash2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { PDFDocumentLoadingTask } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { EventBus, PDFLinkService, PDFViewer } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs'
import { useApp } from '@/features/workspace/client/context'
import { Button } from '@/shared/ui/button'
import { Menu, MenuItem, MenuLabel, MenuSeparator, useContextMenu } from '@/shared/ui/menu'
import { useToast } from '@/shared/ui/toast'
import { cn } from '@/shared/ui/cn'
import { defaultFileUrl } from '@/shared/markdown/syntax'
import { getActiveEditor, insertionToMarkdown, pdfPageLink, type Insertion } from '@/features/notes/client/active-editor'
import { copyText } from '@/shared/client/clipboard'
import { attachmentsKey, useAttachments } from '@/features/attachments/client/queries'
import { niceFileName, uploadAttachment } from '@/features/attachments/client/upload'
import { errorMessage } from '@/shared/client/api'
import { usePref } from '@/shared/client/prefs'
import { DOCUMENT_OPTIONS, fetchPdf, loadPdfjs, renderPdfPage } from '../client/pdfjs'
import { pdfAnnotations, useAnnotations } from '../client/annotations'
import { annotationAtPoint, drawAnnotations, selectionOnPage, type PageView } from '../client/overlay'
import { cleanQuote, joinSelection, sortAnnotations, type SelectionPart } from '../geometry'
import { DEFAULT_ANNOTATION_COLOR } from '../limits'
import type { AnnotationColor, PdfAnnotation } from '../types'
import AnnotationBar, { ANNOTATION_COLORS } from './AnnotationBar'
import AnnotationList from './AnnotationList'

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
/** Farbe für neue Markierungen (zuletzt gewählte) */
const COLOR_KEY = 'noted:pdf:color'
/** Ab dieser Breite steht die Liste der Anmerkungen neben den Seiten (@2xl), darunter liegt sie darüber */
const LIST_BESIDE_WIDTH = 672

type Matches = { current: number; total: number }

// Außerhalb der Komponente: Die Prüfung der Hooks hielte Date.now() in einem Eintrag des Kontextmenüs sonst für einen
// Aufruf beim Rendern
const saveColor = (a: PdfAnnotation, color: AnnotationColor) =>
  pdfAnnotations.save({ ...a, color, updatedAt: Date.now() })

/** Seite unter dem Mauszeiger und die Markierung dort – pdf.js zeichnet die Seiten, die Markierungen liegen darüber */
function pointedAt(viewer: PDFViewer | null, annotations: PdfAnnotation[], e: MouseEvent | React.MouseEvent) {
  const pageEl = e.target instanceof Element ? e.target.closest<HTMLElement>('.page') : null
  const page = Number(pageEl?.dataset.pageNumber) || null
  const view = page ? (viewer?.getPageView(page - 1) as PageView | undefined) : undefined
  const onPage = annotations.filter((a) => a.page === page)
  return { page, annotation: view ? annotationAtPoint(view, onPage, e.clientX, e.clientY) : null }
}

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
  const openContextMenu = useContextMenu()
  const { data: attachments = [] } = useAttachments()
  const pdfs = attachments.filter((a) => a.mime === 'application/pdf')
  const fileName = file.split('/').pop()!.toLowerCase()
  const attachment = pdfs.find((a) => a.filename.toLowerCase() === fileName) ?? null
  const { annotations } = useAnnotations(attachment?.id ?? null)

  const panelRef = useRef<HTMLElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<PDFViewer | null>(null)
  const busRef = useRef<EventBus | null>(null)
  const pendingPage = useRef<number | null>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const findRef = useRef<HTMLInputElement>(null)
  const findButtonRef = useRef<HTMLButtonElement>(null)

  const [status, setStatus] = useState<{ state: 'loading' | 'ready' | 'error'; message?: string }>({ state: 'loading' })
  const [numPages, setNumPages] = useState(0)
  const [current, setCurrent] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const [scale, setScale] = useState(1)
  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<Matches | null>(null)
  // page: erste Seite der Auswahl (für Seitenlinks), parts: je Seite Text und Rechtecke
  const [selection, setSelection] = useState<{ text: string; page: number; parts: SelectionPart[] } | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [focusComment, setFocusComment] = useState(false)
  const [colorPref, setColorPref] = usePref(COLOR_KEY, String(DEFAULT_ANNOTATION_COLOR))
  const active = annotations.find((a) => a.id === activeId) ?? null
  const sorted = sortAnnotations(annotations)

  // Markierungen über den Seiten: pdf.js zeichnet Seiten beim Blättern und Zoomen neu – die Ebene wird dann
  // aus overlay neu aufgebaut (Stand für Ereignisse von pdf.js, die außerhalb von React eintreffen)
  const overlay = useRef({ annotations, activeId, flashId: null as string | null })
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const drawPage = useCallback((pageNumber: number) => {
    const view = viewerRef.current?.getPageView(pageNumber - 1) as PageView | undefined
    if (!view?.div) return
    const { annotations, activeId, flashId } = overlay.current
    drawAnnotations(view, annotations.filter((a) => a.page === pageNumber), { activeId, flashId })
  }, [])
  const drawAll = useCallback(() => {
    const count = viewerRef.current?.pagesCount ?? 0
    for (let n = 1; n <= count; n++) drawPage(n)
  }, [drawPage])

  // Dokument laden
  useEffect(() => {
    const container = containerRef.current
    const inner = innerRef.current
    if (!container || !inner) return
    let cancelled = false
    const ac = new AbortController()
    let task: PDFDocumentLoadingTask | null = null
    // Erst setDocument(null) entfernt, was pdf.js an Listenern und Seiten festhält – sonst bliebe jedes geöffnete PDF
    let opened: { viewer: PDFViewer; linkService: PDFLinkService } | null = null
    pendingPage.current = page ?? loadPositions()[file] ?? 1
    setStatus({ state: 'loading' })
    setSelection(null)
    setActiveId(null)
    setMatches(null)
    ;(async () => {
      try {
        const { pdfjs, viewer: V } = await loadPdfjs()
        const data = await fetchPdf(file, ac.signal)
        if (cancelled) return
        task = pdfjs.getDocument({ data, ...DOCUMENT_OPTIONS })
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
          // Eigene Markierungen statt der Editoren von pdf.js – die hängen sonst Listener an window und document und
          // fangen z. B. Bilder ab, die in die Notiz gezogen werden
          annotationEditorMode: pdfjs.AnnotationEditorType.DISABLE,
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
        eventBus.on('scalechanging', (e: { scale: number }) => {
          setScale(e.scale)
          requestAnimationFrame(drawAll)
        })
        eventBus.on('pagerendered', (e: { pageNumber: number }) => drawPage(e.pageNumber))
        eventBus.on('textlayerrendered', (e: { pageNumber: number }) => drawPage(e.pageNumber))
        eventBus.on('updatefindmatchescount', (e: { matchesCount: Matches }) => setMatches(e.matchesCount))
        eventBus.on('updatefindcontrolstate', (e: { matchesCount: Matches }) => setMatches(e.matchesCount))
        viewer.setDocument(doc)
        linkService.setDocument(doc)
        opened = { viewer, linkService }
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
      opened?.viewer.setDocument(null)
      opened?.linkService.setDocument(null)
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

  // Geänderte Markierungen (auch aus anderen Tabs und nach dem Laden vom Server) neu zeichnen
  useEffect(() => {
    overlay.current.annotations = annotations
    overlay.current.activeId = activeId
    if (status.state === 'ready') drawAll()
  }, [annotations, activeId, status.state, drawAll])

  // Klick auf eine Markierung öffnet sie (Kommentar, Farbe, Löschen), ein Klick daneben schließt sie wieder
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onClick = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || e.target.closest('a, button, input, textarea, select')) return
      if (document.getSelection()?.isCollapsed === false) return
      const hit = pointedAt(viewerRef.current, overlay.current.annotations, e).annotation
      setActiveId(hit?.id ?? null)
      setFocusComment(false)
    }
    container.addEventListener('click', onClick)
    return () => container.removeEventListener('click', onClick)
  }, [])

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

  // Ausgewählter Text im PDF → Aktionen (Markieren, Kommentieren, Zitat, Karteikarte, Kopieren)
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
      // Text und Rechtecke gleich festhalten: Auf dem Handy hebt der Tipp auf „Markieren“ die Auswahl womöglich auf.
      // Jede Seite, die die Auswahl berührt – sie darf über Seitengrenzen gehen.
      const viewer = viewerRef.current
      const parts: SelectionPart[] = []
      if (viewer && sel.rangeCount) {
        const range = sel.getRangeAt(0)
        for (const el of container.querySelectorAll<HTMLElement>('.page')) {
          const n = Number(el.dataset.pageNumber)
          if (!n || !range.intersectsNode(el)) continue
          const view = viewer.getPageView(n - 1) as PageView | undefined
          if (view?.div) parts.push({ page: n, ...selectionOnPage(range, view) })
        }
      }
      const joined = joinSelection(parts, sel.toString())
      const pageEl = (sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode.parentElement)?.closest<HTMLElement>('.page')
      const pageNo = joined.parts[0]?.page ?? (Number(pageEl?.dataset.pageNumber) || viewer?.currentPageNumber || 1)
      setSelection(joined.text ? { text: joined.text, page: pageNo, parts: joined.parts } : null)
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
    // Die Suchleiste verschwindet samt Fokus – zurück zum Knopf, der sie geöffnet hat
    findButtonRef.current?.focus()
  }

  const goTo = (n: number) => {
    const v = viewerRef.current
    if (!v?.pagesCount) return
    v.currentPageNumber = Math.max(1, Math.min(v.pagesCount, n))
  }

  /** Text in die geöffnete Notiz einfügen – ohne offene Notiz eine neue anlegen. */
  function insert(insertion: Insertion, what: string) {
    const editor = getActiveEditor()
    if (editor) {
      editor.insert(insertion)
      toast.success(`${what} in „${editor.title}“ eingefügt.`)
      return
    }
    toast.show('Öffne zuerst eine Notiz, um etwas einzufügen.', {
      action: {
        label: 'Neue Notiz',
        onClick: () =>
          void app.createNote({ title: baseName(file), folderId: null, format: 'markdown', content: insertionToMarkdown(insertion) + '\n' }),
      },
    })
  }

  const pageLink = (n: number, label?: string) => pdfPageLink({ file, page: n }, label)

  const canMark = !!attachment && !!selection?.parts.some((p) => p.rects.length > 0)

  /** Ausgewählten Text markieren – mit Kommentar: gleich das Kommentarfeld öffnen */
  function markSelection(withComment: boolean) {
    const parts = selection?.parts.filter((p) => p.rects.length > 0) ?? []
    if (!selection || !attachment || parts.length === 0) return
    const pref = Number(colorPref)
    const color = (pref >= 1 && pref <= 6 ? pref : DEFAULT_ANNOTATION_COLOR) as AnnotationColor
    // Über Seitengrenzen: eine Markierung je Seite (Rechtecke gelten immer für eine Seite)
    const created = parts.map((p) =>
      pdfAnnotations.create({
        attachmentId: attachment.id,
        page: p.page,
        rects: p.rects,
        quote: cleanQuote(p.text || selection.text),
        comment: '',
        color,
      }),
    )
    document.getSelection()?.removeAllRanges()
    setSelection(null)
    setActiveId(withComment ? created[0].id : null)
    setFocusComment(withComment)
  }

  function quoteSelection() {
    if (selection) insert({ kind: 'quote', text: selection.text, ref: { file, page: selection.page } }, 'Zitat')
  }

  function selectionToCard() {
    if (!selection) return
    app.openCardEditor({
      back: `${selection.text}\n\n${pageLink(selection.page, `${baseName(file)}, S. ${selection.page}`)}`,
      noteId: getActiveEditor()?.noteId ?? null,
      deckName: baseName(file),
    })
  }

  async function copySelection() {
    if (selection && (await copyText(selection.text))) toast.success('Kopiert.')
  }

  /** Zur Markierung blättern und sie kurz aufleuchten lassen */
  function showAnnotation(a: PdfAnnotation) {
    const v = viewerRef.current
    if (!v?.pagesCount) return
    const top = Math.max(...a.rects.map((r) => r[3]))
    v.scrollPageIntoView({ pageNumber: a.page, destArray: [null, { name: 'XYZ' }, 0, top + 24, null] })
    setActiveId(a.id)
    setFocusComment(false)
    clearTimeout(flashTimer.current)
    overlay.current.flashId = a.id
    drawPage(a.page)
    flashTimer.current = setTimeout(() => {
      overlay.current.flashId = null
      drawPage(a.page)
    }, 1600)
    // Liegt die Liste über den Seiten, gibt sie den Blick auf die Markierung frei
    if ((panelRef.current?.offsetWidth ?? 0) < LIST_BESIDE_WIDTH) setListOpen(false)
  }

  function deleteAnnotation(a: PdfAnnotation) {
    pdfAnnotations.remove(a)
    setActiveId(null)
    toast.show('Markierung gelöscht.', {
      action: { label: 'Rückgängig', onClick: () => pdfAnnotations.save({ ...a, updatedAt: Date.now() }) },
    })
  }

  const quoteOf = (a: PdfAnnotation) => ({ text: a.quote, ref: { file, page: a.page } })
  const insertQuote = (a: PdfAnnotation) => insert({ kind: 'quote', ...quoteOf(a) }, 'Zitat')

  /** Gewählte Farbe auch für neue Markierungen übernehmen */
  const rememberColor = (color: AnnotationColor) => setColorPref(String(color))

  /** Farbe einer Markierung aus dem Kontextmenü ändern – wie in ihrer Leiste */
  function recolor(a: PdfAnnotation, color: AnnotationColor) {
    saveColor(a, color)
    rememberColor(color)
  }

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

  /** Seite als Bild in den Anhängen speichern und daraus eine Karte mit Bildverdeckung anlegen */
  async function pageToOcclusion(page: number) {
    try {
      const { blob } = await renderPdfPage(file, page)
      const att = await uploadAttachment(new File([blob], `${baseName(file)} S. ${page}.png`, { type: 'image/png' }))
      await qc.invalidateQueries({ queryKey: attachmentsKey })
      app.openCardEditor({
        type: 'occlusion',
        occlusion: { image: att.filename, masks: [], hideAll: false },
        front: `${baseName(file)}, S. ${page}`,
        noteId: getActiveEditor()?.noteId ?? null,
        deckName: baseName(file),
      })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  // ---- Kontextmenü ----

  // Eine neue Auswahl meldet der Browser erst nach dem Rechtsklick (z. B. das Wort, das der Mac dabei markiert) –
  // die Einträge wirken daher auf die Auswahl, die gilt, wenn sie gewählt werden
  const latest = useRef({ markSelection, quoteSelection, selectionToCard, copySelection })
  useEffect(() => {
    latest.current = { markSelection, quoteSelection, selectionToCard, copySelection }
  })

  /** Weitere Aktionen: im Menü der Leiste für die aktuelle Seite, im Kontextmenü für die angeklickte */
  const pdfActions = (page: number) => (
    <>
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
      <MenuItem
        icon={<Link2 />}
        onSelect={() => insert({ kind: 'page-link', ref: { file, page } }, `Link auf Seite ${page}`)}
        disabled={!ready}
      >
        Seite {page} in Notiz verlinken
      </MenuItem>
      <MenuItem icon={<ImageIcon />} onSelect={() => void pageToOcclusion(page)} disabled={!ready}>
        Seite {page} als Bildverdeckung …
      </MenuItem>
      <MenuItem
        icon={<Copy />}
        onSelect={async () => {
          if (await copyText(pageLink(page))) toast.success('Link kopiert.')
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
    </>
  )

  /** Ausgewählter Text: dieselben Aktionen wie die Leiste unter den Seiten */
  function selectionMenu(canMark: boolean) {
    return (
      <>
        <MenuItem icon={<Copy />} onSelect={() => void latest.current.copySelection()} hint="Strg+C">
          Kopieren
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<Highlighter />} onSelect={() => latest.current.markSelection(false)} disabled={!canMark}>
          Markieren
        </MenuItem>
        <MenuItem icon={<MessageSquare />} onSelect={() => latest.current.markSelection(true)} disabled={!canMark}>
          Markieren und kommentieren
        </MenuItem>
        <MenuItem icon={<Quote />} onSelect={() => latest.current.quoteSelection()}>
          Als Zitat einfügen
        </MenuItem>
        <MenuItem icon={<Layers />} onSelect={() => latest.current.selectionToCard()}>
          Karteikarte anlegen
        </MenuItem>
      </>
    )
  }

  /** Markierung (auf der Seite oder in der Liste): dieselben Aktionen wie ihre Leiste */
  function annotationMenu(a: PdfAnnotation) {
    return (
      <>
        {a.id === activeId ? null : (
          <MenuItem
            icon={<MessageSquare />}
            onSelect={() => {
              setActiveId(a.id)
              setFocusComment(true)
            }}
          >
            Kommentieren
          </MenuItem>
        )}
        <MenuItem icon={<Quote />} onSelect={() => insertQuote(a)}>
          Als Zitat einfügen
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>Farbe</MenuLabel>
        {ANNOTATION_COLORS.map((c) => (
          <MenuItem
            key={c.id}
            icon={<span className="size-3.5 rounded-full" style={{ background: `var(--swatch-${c.id})` }} />}
            onSelect={() => recolor(a, c.id)}
          >
            {c.label}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem icon={<Trash2 />} danger onSelect={() => deleteAnnotation(a)}>
          Markierung löschen
        </MenuItem>
      </>
    )
  }

  function onPagesContextMenu(e: React.MouseEvent) {
    // Auf Links im PDF bleibt das allgemeine Menü (Link öffnen, Adresse kopieren)
    if (!ready || (e.target instanceof Element && e.target.closest('a[href]'))) return
    const live = document.getSelection()
    if (selection && live && !live.isCollapsed) {
      openContextMenu(e, selectionMenu(canMark), { text: true })
      return
    }
    const { page, annotation } = pointedAt(viewerRef.current, annotations, e)
    openContextMenu(e, annotation ? annotationMenu(annotation) : pdfActions(page ?? current), { text: true })
  }

  return (
    <section
      ref={panelRef}
      className="@container flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-subtle"
      aria-label={`PDF: ${file}`}
      data-testid="pdf-panel"
    >
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
            aria-label={`Auf Seitenbreite einpassen (${Math.round(scale * 100)} %)`}
          >
            {Math.round(scale * 100)} %
          </button>
          <Button variant="ghost" size="icon-sm" onClick={() => viewerRef.current?.increaseScale()} disabled={!ready} aria-label="Vergrößern" className="@max-2xl:hidden">
            <ZoomIn className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setListOpen((o) => !o)}
            aria-label="Anmerkungen"
            aria-pressed={listOpen}
            title={annotations.length ? `Anmerkungen (${annotations.length})` : 'Anmerkungen'}
            className="relative"
          >
            <Highlighter className="size-4" />
            {annotations.length ? (
              <span className="absolute top-0.5 right-0.5 min-w-3.5 rounded-full bg-accent px-0.5 text-[9px] leading-3.5 font-semibold text-on-accent tabular-nums">
                {annotations.length > 99 ? '99+' : annotations.length}
              </span>
            ) : null}
          </Button>
          <Button
            ref={findButtonRef}
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
            onClick={() => insert({ kind: 'page-link', ref: { file, page: current } }, `Link auf Seite ${current}`)}
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
            {pdfActions(current)}
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
          <span className="w-16 text-center text-xs text-muted tabular-nums" role="status">
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

      {/* Seiten (pdf.js braucht einen absolut positionierten Container) und die Liste der Anmerkungen */}
      <div className="relative flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <div
            ref={containerRef}
            className="pdf-container absolute inset-0 overflow-auto"
            tabIndex={0}
            onContextMenu={onPagesContextMenu}
          >
            <div ref={innerRef} className="pdfViewer" />
          </div>
        </div>
        {listOpen ? (
          <AnnotationList
            annotations={sorted}
            activeId={activeId}
            onSelect={showAnnotation}
            onContextMenu={(e, a) => openContextMenu(e, annotationMenu(a))}
            onInsertAll={() =>
              insert(
                { kind: 'quotes', quotes: sorted.map(quoteOf) },
                sorted.length === 1 ? 'Zitat' : `${sorted.length} Zitate`,
              )
            }
            onClose={() => setListOpen(false)}
          />
        ) : null}
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

      {/* Aktionen für ausgewählten Text – oder die angeklickte Markierung */}
      {selection ? (
        <div className="flex items-center gap-1 border-t border-border bg-bg px-2 py-1.5" data-testid="pdf-selection">
          <span className="min-w-0 flex-1 truncate text-xs text-muted" title={selection.text}>
            „{selection.text}“
          </span>
          <Button
            size="sm"
            variant="ghost"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => markSelection(false)}
            disabled={!canMark}
            aria-label="Markieren"
            title="Markieren"
          >
            <Highlighter className="size-4" /> <span className="@max-md:hidden">Markieren</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => markSelection(true)}
            disabled={!canMark}
            aria-label="Kommentieren"
            title="Markieren und kommentieren"
          >
            <MessageSquare className="size-4" /> <span className="@max-xl:hidden">Kommentieren</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onMouseDown={(e) => e.preventDefault()}
            onClick={quoteSelection}
            aria-label="Als Zitat einfügen"
            title="Als Zitat mit Seitenlink in die Notiz einfügen"
          >
            <Quote className="size-4" /> <span className="@max-2xl:hidden">Als Zitat einfügen</span>
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onMouseDown={(e) => e.preventDefault()}
            onClick={selectionToCard}
            aria-label="Karteikarte"
            title="Karteikarte anlegen"
          >
            <Layers className="size-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void copySelection()}
            aria-label="Kopieren"
            title="Kopieren"
          >
            <Copy className="size-4" />
          </Button>
        </div>
      ) : active ? (
        <AnnotationBar
          key={active.id}
          annotation={active}
          focusComment={focusComment}
          onInsert={() => insertQuote(active)}
          onColor={rememberColor}
          onDelete={() => deleteAnnotation(active)}
          onClose={() => setActiveId(null)}
        />
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
