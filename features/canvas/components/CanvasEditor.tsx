'use client'
// Canvas-Editor (JSON Canvas): Karten frei anordnen, mit Pfeilen verbinden und gruppieren.
// Wird per next/dynamic nachgeladen (React Flow) und gibt der Notizansicht dieselbe Schnittstelle wie die Text-Editoren.
import { useCallback, useId, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react'
import {
  ArrowLeftRight,
  ArrowRight,
  FilePlus2,
  Group,
  Layers,
  Link2,
  Maximize,
  Minus,
  Palette,
  Pencil,
  Redo2,
  StickyNote,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  CANVAS_COLORS,
  CANVAS_NODE_SIZE,
  nearestSides,
  newCanvasId,
  nodesInGroup,
  parseCanvas,
  serializeCanvas,
  type CanvasData,
  type CanvasEdge,
  type CanvasNode,
  type CanvasSide,
} from '../canvas'
import { CanvasContext, canvasColor, edgeTypes, nodeTypes, safeUrl, type ArrowEdge, type CardNode, type ResolvedFile } from './CanvasCards'
import { FilePicker, LinkDialog, type PickedFile } from './InsertDialogs'
import { AttachButtons, Divider, ToolButton } from '@/features/notes/components/toolbar'
import type { PreviewLinks } from '@/features/notes/components/Preview'
import { insertionToMarkdown } from '@/features/notes/client/active-editor'
import type { NoteEditorHandle } from '@/features/notes/client/editor-handle'
import { useAttachments } from '@/features/attachments/client/queries'
import type { Attachment } from '@/features/attachments/types'
import { FLOW_ARIA_LABELS, FLOW_PRO_OPTIONS } from '@/shared/ui/flow'
import { useReservedSpace } from '@/shared/ui/reserved-space'
import { Menu, MenuItem } from '@/shared/ui/menu'

/** Werkzeug der Leiste: Ein offenes Textfeld verliert beim Klicken den Fokus und speichert, bevor das Werkzeug wirkt */
const Tool = (props: React.ComponentProps<typeof ToolButton>) => <ToolButton keepFocus={false} {...props} />

type Props = {
  handleRef: React.Ref<NoteEditorHandle>
  content: string
  /** Titel der Notiz – das Canvas bietet sich nicht selbst als Karte an */
  title: string
  onChange: (json: string) => void
  readOnly: boolean
  links: PreviewLinks
  onUpload: (files: File[]) => void
  onCreateCard: () => void
  /** Über der Fläche, z. B. das Titelfeld */
  header?: React.ReactNode
}

type Rect = { x: number; y: number; width: number; height: number }
type XY = { x: number; y: number }
type GroupDrag = { id: string; start: XY; members: { id: string; x: number; y: number }[] }

const EMPTY: CanvasData = { nodes: [], edges: [] }
const GRID = 10
const snap = (v: number) => Math.round(v / GRID) * GRID

/** Gruppen liegen unter den Karten, größere unter kleineren */
const area = (n: CanvasNode) => n.width * n.height
const drawOrder = (nodes: CanvasNode[]) =>
  [...nodes.filter((n) => n.type === 'group').sort((a, b) => area(b) - area(a)), ...nodes.filter((n) => n.type !== 'group')]

const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest('input, textarea, [contenteditable]')

function sizeForAttachment(att: Pick<Attachment, 'mime'>) {
  return att.mime.startsWith('image/') ? CANVAS_NODE_SIZE.file : { width: 300, height: 64 }
}

export default function CanvasEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasFlow {...props} />
    </ReactFlowProvider>
  )
}

function CanvasFlow({ handleRef, content, title, onChange, readOnly, links, onUpload, onCreateCard, header }: Props) {
  const flow = useReactFlow<CardNode, ArrowEdge>()
  const wrapperRef = useRef<HTMLDivElement>(null)
  // Die Werkzeugleiste unten rechts setzt sich über die Zoom-Knöpfe
  const zoomSpace = useReservedSpace<HTMLDivElement>('--bottom-right-height')
  const markerId = `canvas-arrow-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  // Stand zum gespeicherten Text; ändert er sich von außen (anderes Gerät), wird neu gelesen
  const [doc, setDoc] = useState(() => ({ source: content, data: parseCanvas(content) ?? EMPTY }))
  if (content !== doc.source) setDoc({ source: content, data: parseCanvas(content) ?? EMPTY })
  const data = doc.data

  const [selectedNodes, setSelectedNodes] = useState<ReadonlySet<string>>(() => new Set())
  const [selectedEdges, setSelectedEdges] = useState<ReadonlySet<string>>(() => new Set())
  const [editing, setEditing] = useState<{ id: string; isNew: boolean } | null>(null)
  const [dialog, setDialog] = useState<'file' | 'link' | null>(null)
  // Position und Größe während des Ziehens – gespeichert wird erst beim Loslassen
  const liveRef = useRef(new Map<string, Rect>())
  const [live, setLive] = useState<ReadonlyMap<string, Rect>>(() => new Map())
  const groupDrag = useRef<GroupDrag[]>([])
  const history = useRef<{ past: CanvasData[]; future: CanvasData[] }>({ past: [], future: [] })
  // Abgelegte Dateien landen an der Stelle, an der sie losgelassen wurden
  const dropAt = useRef<{ at: XY; remaining: number } | null>(null)

  const { data: attachments = [] } = useAttachments()
  const attachmentByName = useMemo(() => new Map(attachments.map((a) => [a.filename.toLowerCase(), a])), [attachments])
  const resolveFile = useCallback(
    (file: string): ResolvedFile => {
      const attachment = attachmentByName.get(file.toLowerCase())
      if (attachment) return { kind: 'attachment', attachment }
      const note = links.resolveNote(file)
      return note ? { kind: 'note', id: note.id, title: note.title } : { kind: 'missing' }
    },
    [attachmentByName, links],
  )

  const nodes = useMemo<CardNode[]>(
    () =>
      drawOrder(data.nodes).map((n) => {
        const r = live.get(n.id) ?? n
        return {
          id: n.id,
          type: 'card',
          position: { x: r.x, y: r.y },
          width: r.width,
          height: r.height,
          // Größe steht in der Datei – nicht erst messen
          measured: { width: r.width, height: r.height },
          data: { node: n },
          // Gruppen unter den Pfeilen, sonst verdeckt ihre Farbe die Pfeile zwischen ihren Karten
          zIndex: n.type === 'group' ? -1 : 0,
          selected: selectedNodes.has(n.id),
          draggable: !readOnly && editing?.id !== n.id,
        }
      }),
    [data.nodes, live, selectedNodes, readOnly, editing],
  )

  const edgeColors = useMemo(() => [...new Set(data.edges.map((e) => e.color ?? ''))], [data.edges])
  const edges = useMemo<ArrowEdge[]>(() => {
    const byId = new Map(data.nodes.map((n) => [n.id, live.get(n.id) ?? n]))
    return data.edges.map((e) => {
      const [fromSide, toSide] = nearestSides(byId.get(e.fromNode)!, byId.get(e.toNode)!)
      // React Flow setzt url(#…) selbst darum
      const marker = `${markerId}-${edgeColors.indexOf(e.color ?? '')}`
      return {
        id: e.id,
        source: e.fromNode,
        target: e.toNode,
        sourceHandle: e.fromSide ?? fromSide,
        targetHandle: e.toSide ?? toSide,
        type: 'arrow',
        selected: selectedEdges.has(e.id),
        data: { label: e.label, color: e.color },
        markerEnd: e.toEnd === 'none' ? undefined : marker,
        markerStart: e.fromEnd === 'arrow' ? marker : undefined,
      }
    })
  }, [data, live, selectedEdges, markerId, edgeColors])

  // ---- Ändern (mit Rückgängig) ----

  function commit(next: CanvasData, record = true) {
    if (record) {
      const h = history.current
      h.past.push(data)
      if (h.past.length > 200) h.past.shift()
      h.future = []
    }
    const json = serializeCanvas(next)
    setDoc({ source: json, data: next })
    onChange(json)
  }

  function undo() {
    const prev = history.current.past.pop()
    if (!prev) return
    history.current.future.push(data)
    commit(prev, false)
    setEditing(null)
  }

  function redo() {
    const next = history.current.future.pop()
    if (!next) return
    history.current.past.push(data)
    commit(next, false)
  }

  const focusFlow = () => wrapperRef.current?.focus({ preventScroll: true })

  function selectOnly(nodeIds: string[], edgeIds: string[] = []) {
    setSelectedNodes(new Set(nodeIds))
    setSelectedEdges(new Set(edgeIds))
  }

  /** Mitte des sichtbaren Bereichs in Canvas-Koordinaten */
  function viewportCenter(): XY {
    const r = wrapperRef.current?.getBoundingClientRect()
    if (!r) return { x: 0, y: 0 }
    return flow.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
  }

  /**
   * Stelle für eine neue Karte: an der angegebenen Stelle (Doppelklick, abgelegte Datei) – sonst möglichst nah an
   * der Mitte des sichtbaren Bereichs, ohne andere Karten zu verdecken
   */
  function placeAt(size: { width: number; height: number }, at?: XY): XY {
    const c = at ?? viewportCenter()
    const x0 = snap(c.x - size.width / 2)
    const y0 = snap(c.y - size.height / 2)
    if (at) {
      let x = x0
      let y = y0
      while (data.nodes.some((n) => n.x === x && n.y === y)) {
        x += 30
        y += 30
      }
      return { x, y }
    }
    const gap = 20
    const cards = data.nodes.filter((n) => n.type !== 'group')
    const free = (x: number, y: number) =>
      !cards.some((n) => x < n.x + n.width + gap && n.x < x + size.width + gap && y < n.y + n.height + gap && n.y < y + size.height + gap)
    const view = visibleArea()
    const inView = (x: number, y: number) =>
      !view || (x >= view.x && y >= view.y && x + size.width <= view.x + view.width && y + size.height <= view.y + view.height)
    // Freie Stellen rund um die Mitte: zuerst im sichtbaren Bereich, nah an der Mitte, lieber darunter als darüber
    const step = 60
    const spots: { x: number; y: number; score: number }[] = []
    for (let dy = -12; dy <= 12; dy++) {
      for (let dx = -12; dx <= 12; dx++) {
        const x = x0 + dx * step
        const y = y0 + dy * step
        if (free(x, y)) spots.push({ x, y, score: (inView(x, y) ? 0 : 1e6) + dx * dx + dy * dy * (dy < 0 ? 1.5 : 1) })
      }
    }
    const best = spots.sort((a, b) => a.score - b.score)[0]
    return best ? { x: best.x, y: best.y } : { x: x0, y: y0 }
  }

  /** Sichtbarer Bereich in Canvas-Koordinaten */
  function visibleArea(): Rect | null {
    const r = wrapperRef.current?.getBoundingClientRect()
    if (!r || r.width === 0) return null
    const a = flow.screenToFlowPosition({ x: r.left, y: r.top })
    const b = flow.screenToFlowPosition({ x: r.right, y: r.bottom })
    return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y }
  }

  /** Neue Karte ins Bild holen, wenn sie nicht ganz zu sehen ist (z. B. auf dem Handy) */
  function reveal(rect: Rect) {
    const view = visibleArea()
    if (!view) return
    const inside =
      rect.x >= view.x && rect.y >= view.y && rect.x + rect.width <= view.x + view.width && rect.y + rect.height <= view.y + view.height
    if (!inside) void flow.setCenter(rect.x + rect.width / 2, rect.y + rect.height / 2, { zoom: flow.getZoom(), duration: 200 })
  }

  function addNode(node: CanvasNode, edit = false) {
    commit({ ...data, nodes: [...data.nodes, node] })
    selectOnly([node.id])
    setEditing(edit ? { id: node.id, isNew: true } : null)
    reveal(node)
  }

  function addText(text = '', at?: XY) {
    const size = CANVAS_NODE_SIZE.text
    addNode({ id: newCanvasId(), type: 'text', text, ...placeAt(size, at), ...size }, !text)
  }

  function addFile(picked: PickedFile, at?: XY) {
    const size = picked.kind === 'note' ? CANVAS_NODE_SIZE.note : sizeForAttachment(picked.attachment)
    const file = picked.kind === 'note' ? picked.title : picked.attachment.filename
    addNode({ id: newCanvasId(), type: 'file', file, ...placeAt(size, at), ...size })
  }

  function addLink(url: string) {
    const size = CANVAS_NODE_SIZE.link
    addNode({ id: newCanvasId(), type: 'link', url, ...placeAt(size), ...size })
  }

  /** Gruppe um die ausgewählten Karten – ohne Auswahl in der Mitte */
  function addGroup() {
    const inside = data.nodes.filter((n) => selectedNodes.has(n.id))
    const pad = 30
    const rect: Rect = inside.length
      ? {
          x: Math.min(...inside.map((n) => n.x)) - pad,
          y: Math.min(...inside.map((n) => n.y)) - pad,
          width: Math.max(...inside.map((n) => n.x + n.width)) - Math.min(...inside.map((n) => n.x)) + pad * 2,
          height: Math.max(...inside.map((n) => n.y + n.height)) - Math.min(...inside.map((n) => n.y)) + pad * 2,
        }
      : { ...placeAt(CANVAS_NODE_SIZE.group), ...CANVAS_NODE_SIZE.group }
    addNode({ id: newCanvasId(), type: 'group', label: '', ...rect }, true)
  }

  function removeSelection() {
    if (readOnly || (selectedNodes.size === 0 && selectedEdges.size === 0)) return
    commit({
      nodes: data.nodes.filter((n) => !selectedNodes.has(n.id)),
      edges: data.edges.filter((e) => !selectedEdges.has(e.id) && !selectedNodes.has(e.fromNode) && !selectedNodes.has(e.toNode)),
    })
    selectOnly([])
  }

  function applyColor(color: string | undefined) {
    commit({
      nodes: data.nodes.map((n) => (selectedNodes.has(n.id) ? { ...n, color } : n)),
      edges: data.edges.map((e) => (selectedEdges.has(e.id) ? { ...e, color } : e)),
    })
  }

  function setArrows(kind: 'end' | 'both' | 'none') {
    commit({
      ...data,
      edges: data.edges.map((e) =>
        selectedEdges.has(e.id)
          ? { ...e, fromEnd: kind === 'both' ? 'arrow' : undefined, toEnd: kind === 'none' ? 'none' : undefined }
          : e,
      ),
    })
  }

  function startEdit(id: string) {
    if (readOnly) return
    const node = data.nodes.find((n) => n.id === id)
    if (node && node.type !== 'text' && node.type !== 'group') return
    if (!node && !data.edges.some((e) => e.id === id)) return
    setEditing({ id, isNew: false })
  }

  /** Text einer Karte, Name einer Gruppe oder Beschriftung eines Pfeils übernehmen */
  function commitText(id: string, text: string) {
    const wasNew = editing?.id === id && editing.isNew
    setEditing(null)
    focusFlow()
    const node = data.nodes.find((n) => n.id === id)
    if (node?.type === 'text') {
      // Neu angelegt und leer gelassen: Karte wieder entfernen, als wäre nichts passiert
      if (wasNew && !text.trim()) return undo()
      if (text !== node.text) commit({ ...data, nodes: data.nodes.map((n) => (n.id === id ? { ...node, text } : n)) }, !wasNew)
    } else if (node?.type === 'group') {
      const label = text.trim() || undefined
      if (label !== node.label) commit({ ...data, nodes: data.nodes.map((n) => (n.id === id ? { ...node, label } : n)) }, !wasNew)
    } else {
      const edge = data.edges.find((e) => e.id === id)
      const label = text.trim() || undefined
      if (edge && label !== edge.label) commit({ ...data, edges: data.edges.map((e) => (e.id === id ? { ...edge, label } : e)) })
    }
  }

  // ---- Ziehen, Größe ändern, Auswahl ----

  function rectOf(id: string): Rect | undefined {
    return liveRef.current.get(id) ?? data.nodes.find((n) => n.id === id)
  }

  function commitLive() {
    const changed = liveRef.current
    groupDrag.current = []
    if (changed.size === 0) return
    liveRef.current = new Map()
    setLive(new Map())
    const nodes = data.nodes.map((n) => {
      const r = changed.get(n.id)
      if (!r) return n
      const next = { ...n, x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
      return next.x === n.x && next.y === n.y && next.width === n.width && next.height === n.height ? n : next
    })
    if (nodes.some((n, i) => n !== data.nodes[i])) commit({ ...data, nodes })
  }

  function onNodesChange(changes: NodeChange<CardNode>[]) {
    let moved = false
    let resized = false
    for (const c of changes) {
      if (c.type === 'select') {
        setSelectedNodes((prev) => {
          const next = new Set(prev)
          if (c.selected) next.add(c.id)
          else next.delete(c.id)
          return next
        })
      } else if (c.type === 'position' && c.position) {
        const base = rectOf(c.id)
        if (!base) continue
        liveRef.current.set(c.id, { ...base, x: c.position.x, y: c.position.y })
        moved = true
        // Eine Gruppe nimmt ihre Karten mit
        const g = groupDrag.current.find((d) => d.id === c.id)
        if (g) {
          const dx = c.position.x - g.start.x
          const dy = c.position.y - g.start.y
          for (const m of g.members) {
            const r = rectOf(m.id)
            if (r) liveRef.current.set(m.id, { ...r, x: m.x + dx, y: m.y + dy })
          }
        }
      } else if (c.type === 'dimensions' && c.dimensions && c.resizing !== undefined) {
        // Nur Änderungen durch Ziehen am Rand – nicht das Nachmessen durch den Browser
        const base = rectOf(c.id)
        if (!base) continue
        liveRef.current.set(c.id, { ...base, width: c.dimensions.width, height: c.dimensions.height })
        moved = true
        if (!c.resizing) resized = true
      }
    }
    if (resized) commitLive()
    else if (moved) setLive(new Map(liveRef.current))
  }

  function onEdgesChange(changes: EdgeChange<ArrowEdge>[]) {
    for (const c of changes) {
      if (c.type !== 'select') continue
      setSelectedEdges((prev) => {
        const next = new Set(prev)
        if (c.selected) next.add(c.id)
        else next.delete(c.id)
        return next
      })
    }
  }

  function onDragStart(dragged: CardNode[]) {
    const ids = new Set(dragged.map((n) => n.id))
    groupDrag.current = dragged
      .filter((n) => n.data.node.type === 'group')
      .map((g) => ({
        id: g.id,
        start: { ...g.position },
        members: nodesInGroup(data.nodes, g.data.node)
          .filter((m) => !ids.has(m.id))
          .map((m) => ({ id: m.id, x: m.x, y: m.y })),
      }))
  }

  function onConnect(c: Connection) {
    if (!c.source || !c.target || c.source === c.target) return
    const edge: CanvasEdge = {
      id: newCanvasId(),
      fromNode: c.source,
      fromSide: (c.sourceHandle ?? undefined) as CanvasSide | undefined,
      toNode: c.target,
      toSide: (c.targetHandle ?? undefined) as CanvasSide | undefined,
    }
    commit({ ...data, edges: [...data.edges, edge] })
    selectOnly([], [edge.id])
  }

  function openNode(node: CanvasNode) {
    if (node.type === 'link') {
      const href = safeUrl(node.url)
      if (href) window.open(href, '_blank', 'noopener,noreferrer')
    } else if (node.type === 'file') {
      const file = resolveFile(node.file)
      if (file.kind === 'note') links.onOpenNote(file.id)
      else if (file.kind === 'attachment' && file.attachment.mime === 'application/pdf') {
        const page = /^#page=(\d{1,5})$/.exec(node.subpath ?? '')?.[1]
        links.onOpenPdf?.(file.attachment.filename, page ? Number(page) : undefined)
      }
    }
  }

  // ---- Tastatur, Einfügen, Ablegen ----

  function onKeyDown(e: React.KeyboardEvent) {
    if (editing || isTyping(e.target)) return
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      return e.shiftKey ? redo() : undo()
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault()
      return redo()
    }
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      return selectOnly(data.nodes.map((n) => n.id))
    }
    if (e.key === 'Escape') return selectOnly([])
    if (readOnly) return
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      return removeSelection()
    }
    const single = selectedNodes.size + selectedEdges.size === 1 ? ([...selectedNodes][0] ?? [...selectedEdges][0]) : null
    if ((e.key === 'Enter' || e.key === 'F2') && single) {
      e.preventDefault()
      startEdit(single)
    }
  }

  function onPaste(e: React.ClipboardEvent) {
    if (readOnly || editing || isTyping(e.target)) return
    const files = Array.from(e.clipboardData.files)
    if (files.length) {
      e.preventDefault()
      dropAt.current = null
      return onUpload(files)
    }
    const text = e.clipboardData.getData('text/plain').trim()
    if (!text) return
    e.preventDefault()
    if (safeUrl(text)) addLink(text)
    else addText(text)
  }

  function onDrop(e: React.DragEvent) {
    const files = Array.from(e.dataTransfer.files)
    if (readOnly || files.length === 0) return
    e.preventDefault()
    dropAt.current = { at: flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }), remaining: files.length }
    onUpload(files)
  }

  // Ohne Abhängigkeitsliste: Der Handle soll immer den aktuellen Stand sehen
  useImperativeHandle(handleRef, () => ({
    focus: () => focusFlow(),
    setDoc: (json) => setDoc({ source: json, data: parseCanvas(json) ?? EMPTY }),
    // Seitenlink oder Zitat aus dem PDF als Textkarte
    insert: (insertion) => addText(insertionToMarkdown(insertion)),
    insertAttachment: (att) => {
      const drop = dropAt.current
      // Mehrere Dateien leicht versetzt ablegen
      if (drop) {
        dropAt.current = drop.remaining > 1 ? { at: { x: drop.at.x + 30, y: drop.at.y + 30 }, remaining: drop.remaining - 1 } : null
      }
      addFile({ kind: 'attachment', attachment: att }, drop?.at)
    },
    selectedText: () => {
      const node = selectedNodes.size === 1 ? data.nodes.find((n) => selectedNodes.has(n.id)) : undefined
      return node?.type === 'text' ? node.text : ''
    },
  }))

  const ctx = { readOnly, editingId: editing?.id ?? null, links, resolveFile, commitText }
  const hasSelection = selectedNodes.size + selectedEdges.size > 0
  const single = selectedNodes.size + selectedEdges.size === 1
  const editable =
    single && (selectedEdges.size === 1 || data.nodes.some((n) => selectedNodes.has(n.id) && (n.type === 'text' || n.type === 'group')))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {readOnly ? null : (
        <div className="border-b border-border">
          <div className="flex items-center gap-0.5 overflow-x-auto px-2 py-1 [scrollbar-width:none]" role="toolbar" aria-label="Canvas">
            <Tool label="Textkarte" onClick={() => addText()}>
              <StickyNote />
            </Tool>
            <Tool label="Notiz oder Datei einfügen" onClick={() => setDialog('file')}>
              <FilePlus2 />
            </Tool>
            <AttachButtons onUpload={onUpload} />
            <Tool label="Link einfügen" onClick={() => setDialog('link')}>
              <Link2 />
            </Tool>
            <Tool label={selectedNodes.size ? 'Auswahl gruppieren' : 'Gruppe'} onClick={addGroup}>
              <Group />
            </Tool>
            <Divider />
            <Tool label="Bearbeiten (Enter)" onClick={() => startEdit([...selectedNodes][0] ?? [...selectedEdges][0])} disabled={!editable}>
              <Pencil />
            </Tool>
            <Menu
              align="left"
              trigger={(p) => (
                <Tool label="Farbe" disabled={!hasSelection} {...p}>
                  <Palette />
                </Tool>
              )}
            >
              <MenuItem onSelect={() => applyColor(undefined)} icon={<span className="canvas-swatch" />}>
                Keine Farbe
              </MenuItem>
              {CANVAS_COLORS.map((c) => (
                <MenuItem
                  key={c.id}
                  onSelect={() => applyColor(c.id)}
                  icon={<span className="canvas-swatch" style={{ background: canvasColor(c.id) }} />}
                >
                  {c.label}
                </MenuItem>
              ))}
            </Menu>
            {selectedEdges.size > 0 ? (
              <Menu
                align="left"
                trigger={(p) => (
                  <Tool label="Pfeilspitzen" {...p}>
                    <ArrowRight />
                  </Tool>
                )}
              >
                <MenuItem onSelect={() => setArrows('end')} icon={<ArrowRight />}>
                  Pfeil zum Ziel
                </MenuItem>
                <MenuItem onSelect={() => setArrows('both')} icon={<ArrowLeftRight />}>
                  Pfeil in beide Richtungen
                </MenuItem>
                <MenuItem onSelect={() => setArrows('none')} icon={<Minus />}>
                  Linie ohne Pfeil
                </MenuItem>
              </Menu>
            ) : null}
            <Tool label="Löschen (Entf)" onClick={removeSelection} disabled={!hasSelection}>
              <Trash2 />
            </Tool>
            <Divider />
            <Tool label="Karteikarte aus Karte" onClick={onCreateCard}>
              <Layers />
            </Tool>
            <Tool label="Rückgängig (Strg+Z)" onClick={undo}>
              <Undo2 />
            </Tool>
            <Tool label="Wiederholen (Strg+Umschalt+Z)" onClick={redo}>
              <Redo2 />
            </Tool>
          </div>
        </div>
      )}
      {header}
      <CanvasContext.Provider value={ctx}>
        <div
          ref={wrapperRef}
          className="canvas-flow flow-surface relative min-h-0 flex-1 outline-none"
          tabIndex={0}
          role="application"
          aria-label="Canvas – Doppelklick legt eine Textkarte an, Entf löscht die Auswahl"
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onDragOver={(e) => {
            if (!readOnly && e.dataTransfer.types.includes('Files')) e.preventDefault()
          }}
          onDrop={onDrop}
          onPointerDown={(e) => {
            // React Flow verhindert den Fokus beim Klicken – Tastenbefehle sollen trotzdem hier ankommen
            if (!isTyping(e.target) && !(e.target as HTMLElement).closest('button, a')) focusFlow()
          }}
          onDoubleClick={(e) => {
            if (readOnly || !(e.target as HTMLElement).classList.contains('react-flow__pane')) return
            addText('', flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }))
          }}
          data-testid="canvas"
        >
          <svg className="absolute size-0" aria-hidden="true">
            <defs>
              {edgeColors.map((color, i) => (
                <marker
                  key={color || 'none'}
                  id={`${markerId}-${i}`}
                  viewBox="-10 -6 12 12"
                  refX="0"
                  refY="0"
                  markerWidth="14"
                  markerHeight="14"
                  markerUnits="userSpaceOnUse"
                  orient="auto-start-reverse"
                >
                  <path d="M-9,-5 L0,0 L-9,5 Z" style={{ fill: canvasColor(color) ?? 'var(--edge)' }} />
                </marker>
              ))}
            </defs>
          </svg>
          <ReactFlow<CardNode, ArrowEdge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStart={(_e, _n, dragged) => onDragStart(dragged)}
            onNodeDragStop={commitLive}
            onNodeClick={(_e, n) => {
              // Zweiter Tipp auf eine ausgewählte Textkarte beginnt das Bearbeiten (wichtig auf dem Handy)
              if (!readOnly && selectedNodes.size === 1 && selectedNodes.has(n.id) && n.data.node.type === 'text') startEdit(n.id)
              else if (readOnly) openNode(n.data.node)
            }}
            onNodeDoubleClick={(_e, n) => {
              if (n.data.node.type === 'text' || n.data.node.type === 'group') startEdit(n.id)
              else openNode(n.data.node)
            }}
            onEdgeDoubleClick={(_e, edge) => startEdit(edge.id)}
            onPaneClick={() => setEditing(null)}
            connectionMode={ConnectionMode.Loose}
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            elementsSelectable={!readOnly}
            nodesFocusable={false}
            edgesFocusable={false}
            elevateNodesOnSelect={false}
            deleteKeyCode={null}
            zoomOnDoubleClick={false}
            panOnScroll
            snapToGrid
            snapGrid={[GRID, GRID]}
            minZoom={0.1}
            maxZoom={2.5}
            nodeDragThreshold={4}
            connectionRadius={30}
            fitView
            fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
            ariaLabelConfig={FLOW_ARIA_LABELS}
            proOptions={FLOW_PRO_OPTIONS}
          >
            <Background variant={BackgroundVariant.Lines} gap={20} />
            {data.nodes.length === 0 && !readOnly ? (
              <Panel position="top-center" className="canvas-hint">
                Doppelklick auf die Fläche oder <StickyNote className="inline size-3.5" /> legt eine Karte an. Ziehe von einem Rand
                zum nächsten, um Karten zu verbinden.
              </Panel>
            ) : null}
            <Panel ref={zoomSpace} position="bottom-right" className="flow-panel">
              <ToolButton label="Verkleinern" onClick={() => void flow.zoomOut({ duration: 150 })}>
                <ZoomOut />
              </ToolButton>
              <ToolButton label="Vergrößern" onClick={() => void flow.zoomIn({ duration: 150 })}>
                <ZoomIn />
              </ToolButton>
              <ToolButton label="Alles anzeigen" onClick={() => void flow.fitView({ padding: 0.15, maxZoom: 1, duration: 200 })}>
                <Maximize />
              </ToolButton>
            </Panel>
          </ReactFlow>
        </div>
      </CanvasContext.Provider>
      <FilePicker
        open={dialog === 'file'}
        excludeTitle={title}
        onClose={() => setDialog(null)}
        onPick={(file) => {
          setDialog(null)
          addFile(file)
        }}
      />
      <LinkDialog
        open={dialog === 'link'}
        onClose={() => setDialog(null)}
        onSubmit={(url) => {
          setDialog(null)
          addLink(url)
        }}
      />
    </div>
  )
}
