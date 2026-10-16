'use client'
// Mindmap-Editor: Die Markdown-Gliederung erscheint als Baum um die Wurzel. Wird per next/dynamic nachgeladen
// (React Flow) und gibt der Notizansicht dieselbe Schnittstelle wie die Text-Editoren.
import { createContext, useCallback, useContext, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Handle,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react'
import {
  ArrowDown,
  ArrowUp,
  ChevronsDownUp,
  ChevronsUpDown,
  CornerDownRight,
  Layers,
  ListIndentIncrease,
  Maximize,
  Pencil,
  Redo2,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  addChild,
  addSibling,
  branchSwatch,
  cleanNodeText,
  estimateNodeSize,
  findNode,
  findParent,
  layoutMindmap,
  mindmapPropertiesOf,
  moveNode,
  newNodeId,
  parseMindmap,
  removeNode,
  serializeMindmap,
  setNodeText,
  shiftNode,
  type MindNode,
  type PlacedNode,
  type Size,
} from '../mindmap'
import { Preview, type PreviewLinks } from '@/features/notes/components/Preview'
import { AttachButtons, Divider, ToolButton } from '@/features/notes/components/toolbar'
import { insertionToMarkdown } from '@/features/notes/client/active-editor'
import { attachmentMarkdown } from '@/features/attachments/client/upload'
import type { NoteEditorHandle } from '@/features/notes/client/editor-handle'
import { FLOW_ARIA_LABELS, FLOW_PRO_OPTIONS } from '@/shared/ui/flow'
import { cn } from '@/shared/ui/cn'

/** Werkzeug der Leiste: Ein offenes Textfeld verliert beim Klicken den Fokus und speichert, bevor das Werkzeug wirkt */
const Tool = (props: React.ComponentProps<typeof ToolButton>) => <ToolButton keepFocus={false} {...props} />

type Props = {
  handleRef: React.Ref<NoteEditorHandle>
  content: string
  /** Wurzel, solange die Notiz noch leer ist */
  title: string
  onChange: (markdown: string) => void
  readOnly: boolean
  links: PreviewLinks
  onUpload: (files: File[]) => void
  onCreateCard: () => void
  autoFocus?: boolean
  /** Über der Fläche, z. B. das Titelfeld */
  header?: React.ReactNode
}

type MindData = { placed: PlacedNode; hidden: number }
type MindFlowNode = Node<MindData, 'mind'>
type BranchEdge = Edge<{ branch: number; depth: number }, 'branch'>

type Editing = { id: string; initial: string; selectAll: boolean; isNew: boolean }

type MindContextValue = {
  readOnly: boolean
  selectedId: string | null
  editing: Editing | null
  dropTargetId: string | null
  links: PreviewLinks
  commitText: (id: string, text: string, next?: 'child') => void
  cancelEdit: (id: string) => void
  toggleCollapsed: (id: string) => void
  toggleTask: (id: string) => void
}

const MindContext = createContext<MindContextValue | null>(null)

const branchColor = (branch: number) => (branch < 0 ? 'var(--accent)' : `var(--swatch-${branchSwatch(branch)})`)

const TASK_RE = /^\[([ xX])\]\s+/

const descendants = (n: MindNode): number => n.children.reduce((sum, c) => sum + 1 + descendants(c), 0)
const subtreeIds = (n: MindNode): string[] => [n.id, ...n.children.flatMap(subtreeIds)]

function autosize(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

function NodeEditor({ id, editing }: { id: string; editing: Editing }) {
  const ctx = useContext(MindContext)!
  const [value, setValue] = useState(editing.initial)
  const ref = useRef<HTMLTextAreaElement>(null)
  const done = useRef(false)

  // Sofort fokussieren, damit schnell getippte Zeichen nicht verloren gehen
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus({ preventScroll: true })
    if (editing.selectAll) el.select()
    else el.setSelectionRange(el.value.length, el.value.length)
    autosize(el)
  }, [editing])

  const finish = (next?: 'child') => {
    if (done.current) return
    done.current = true
    ctx.commitText(id, value, next)
  }

  return (
    <textarea
      ref={ref}
      value={value}
      rows={1}
      aria-label="Text des Knotens"
      className="mind-input nodrag nowheel"
      onChange={(e) => {
        setValue(e.target.value.replace(/\r?\n/g, ' '))
        autosize(e.target)
      }}
      onKeyDown={(e) => {
        // Tasten beim Schreiben nicht als Befehle der Mindmap auswerten
        e.stopPropagation()
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Enter') {
          e.preventDefault()
          finish()
        } else if (e.key === 'Tab') {
          e.preventDefault()
          finish('child')
        } else if (e.key === 'Escape') {
          e.preventDefault()
          done.current = true
          ctx.cancelEdit(id)
        }
      }}
      onBlur={() => finish()}
    />
  )
}

function NodeText({ id, text }: { id: string; text: string }) {
  const ctx = useContext(MindContext)!
  const task = TASK_RE.exec(text)
  const body = task ? text.slice(task[0].length) : text
  return (
    <div className="mind-text">
      {task ? (
        <input
          type="checkbox"
          className="nodrag task-checkbox"
          checked={task[1] !== ' '}
          disabled={ctx.readOnly}
          onChange={() => ctx.toggleTask(id)}
          onClick={(e) => e.stopPropagation()}
          aria-label="Aufgabe erledigt"
        />
      ) : null}
      {body ? <Preview content={body} {...ctx.links} className="card-markdown mind-md" /> : <span className="mind-empty">Leer</span>}
    </div>
  )
}

function MindNodeView({ id, data }: NodeProps<MindFlowNode>) {
  const ctx = useContext(MindContext)!
  const { node, depth, side, branch } = data.placed
  const editing = ctx.editing?.id === id ? ctx.editing : null
  const hasChildren = node.children.length > 0
  return (
    <div
      className={cn(
        'mind-node',
        depth === 0 ? 'mind-root' : depth === 1 ? 'mind-main' : 'mind-leaf',
        ctx.selectedId === id && 'is-selected',
        ctx.dropTargetId === id && 'is-drop',
      )}
      style={{ '--branch': branchColor(branch) } as React.CSSProperties}
      data-testid="mind-node"
      data-depth={depth}
      aria-selected={ctx.selectedId === id}
    >
      <Handle type="target" id="l-t" position={Position.Left} isConnectable={false} />
      <Handle type="source" id="l-s" position={Position.Left} isConnectable={false} />
      <Handle type="target" id="r-t" position={Position.Right} isConnectable={false} />
      <Handle type="source" id="r-s" position={Position.Right} isConnectable={false} />
      {editing ? <NodeEditor id={id} editing={editing} /> : <NodeText id={id} text={node.text} />}
      {hasChildren && depth > 0 ? (
        <button
          type="button"
          className="mind-toggle nodrag"
          data-side={side}
          onClick={(e) => {
            e.stopPropagation()
            ctx.toggleCollapsed(id)
          }}
          aria-label={data.hidden ? `Ast aufklappen (${data.hidden})` : 'Ast einklappen'}
          title={data.hidden ? 'Aufklappen' : 'Einklappen'}
        >
          {data.hidden ? data.hidden : '−'}
        </button>
      ) : null}
    </div>
  )
}

function BranchEdgeView({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<BranchEdge>) {
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, curvature: 0.4 })
  return (
    <BaseEdge
      path={path}
      style={{ stroke: branchColor(data?.branch ?? -1), strokeWidth: (data?.depth ?? 2) <= 1 ? 2.5 : 1.75, strokeLinecap: 'round' }}
    />
  )
}

const nodeTypes = { mind: MindNodeView }
const edgeTypes = { branch: BranchEdgeView }

export default function MindmapEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <MindmapFlow {...props} />
    </ReactFlowProvider>
  )
}

function MindmapFlow({ handleRef, content, title, onChange, readOnly, links, onUpload, onCreateCard, autoFocus, header }: Props) {
  const flow = useReactFlow<MindFlowNode, BranchEdge>()
  const wrapperRef = useRef<HTMLDivElement>(null)
  // Baum zum gespeicherten Text; ändert sich der Text von außen (anderes Gerät, Textansicht), wird neu gelesen
  const [doc, setDoc] = useState(() => ({ source: content, root: parseMindmap(content, title) }))
  if (content !== doc.source) setDoc({ source: content, root: parseMindmap(content, title) })
  const root = doc.root
  const properties = useMemo(() => mindmapPropertiesOf(doc.source), [doc.source])

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  // Neue Mindmap: Wurzel ausgewählt, damit Tab sofort den ersten Ast anlegt
  const [selectedId, setSelectedId] = useState<string | null>(() => (autoFocus ? doc.root.id : null))
  const [editing, setEditing] = useState<Editing | null>(null)
  const [sizes, setSizes] = useState<ReadonlyMap<string, Size>>(() => new Map())
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const history = useRef<{ past: MindNode[]; future: MindNode[] }>({ past: [], future: [] })
  const selected = selectedId ? findNode(root, selectedId) : null

  const sizeOf = useCallback((n: MindNode, depth: number) => sizes.get(n.id) ?? estimateNodeSize(n.text, depth), [sizes])
  const placed = useMemo(() => layoutMindmap(root, sizeOf, collapsed), [root, sizeOf, collapsed])

  const nodes = useMemo<MindFlowNode[]>(() => {
    const dragged = drag ? placed.find((p) => p.node.id === drag.id) : undefined
    // Beim Ziehen wandert der ganze Ast mit
    const moving = dragged ? new Set(subtreeIds(dragged.node)) : null
    const dx = dragged && drag ? drag.x - dragged.x : 0
    const dy = dragged && drag ? drag.y - dragged.y : 0
    return placed.map((p) => ({
      id: p.node.id,
      type: 'mind',
      position: moving?.has(p.node.id) ? { x: p.x + dx, y: p.y + dy } : { x: p.x, y: p.y },
      // Bis zur Messung die geschätzte Größe – sonst blendet React Flow neue Knoten aus (und ihr Textfeld bekäme keinen Fokus)
      measured: sizes.get(p.node.id) ?? { width: p.width, height: p.height },
      data: { placed: p, hidden: collapsed.has(p.node.id) ? descendants(p.node) : 0 },
      draggable: !readOnly && p.depth > 0 && editing?.id !== p.node.id,
      className: moving?.has(p.node.id) ? 'is-moving' : undefined,
    }))
  }, [placed, drag, sizes, collapsed, readOnly, editing])

  const edges = useMemo<BranchEdge[]>(
    () =>
      placed
        .filter((p) => p.parentId)
        .map((p) => ({
          id: `e-${p.node.id}`,
          source: p.parentId!,
          target: p.node.id,
          sourceHandle: p.side === 'left' ? 'l-s' : 'r-s',
          targetHandle: p.side === 'left' ? 'r-t' : 'l-t',
          type: 'branch',
          data: { branch: p.branch, depth: p.depth },
          selectable: false,
          focusable: false,
        })),
    [placed],
  )

  // ---- Ändern (mit Rückgängig) ----

  /** Neuen Stand übernehmen; `record`: Stände für „Rückgängig“ (Standard: der bisherige) */
  function commit(next: MindNode, record: MindNode[] = [root]) {
    if (next === root) return
    if (record.length) {
      const h = history.current
      h.past.push(...record)
      if (h.past.length > 200) h.past.splice(0, h.past.length - 200)
      h.future = []
    }
    const markdown = serializeMindmap(next, properties)
    setDoc({ source: markdown, root: next })
    onChange(markdown)
  }

  function undo() {
    const prev = history.current.past.pop()
    if (!prev) return
    history.current.future.push(root)
    commit(prev, [])
  }

  function redo() {
    const next = history.current.future.pop()
    if (!next) return
    history.current.past.push(root)
    commit(next, [])
  }

  const focusFlow = () => wrapperRef.current?.focus({ preventScroll: true })

  function select(id: string | null) {
    setSelectedId(id)
    setEditing(null)
  }

  function startEdit(id: string, initial?: string) {
    if (readOnly) return
    const n = findNode(root, id)
    if (!n) return
    setSelectedId(id)
    setEditing({ id, initial: initial ?? n.text, selectAll: initial === undefined, isNew: false })
  }

  /** Neuen leeren Knoten anlegen und gleich bearbeiten */
  function insert(where: 'child' | 'sibling', text = '') {
    const target = selected ?? root
    const child: MindNode = { id: newNodeId(), text, children: [] }
    const next = where === 'child' || target.id === root.id ? addChild(root, target.id, child) : addSibling(root, target.id, child)
    if (where === 'child' && collapsed.has(target.id)) {
      setCollapsed((c) => new Set([...c].filter((id) => id !== target.id)))
    }
    commit(next)
    setSelectedId(child.id)
    if (!text) setEditing({ id: child.id, initial: '', selectAll: false, isNew: true })
  }

  function remove(id: string) {
    if (readOnly || id === root.id) return
    const at = findParent(root, id)
    commit(removeNode(root, id))
    const siblings = at?.parent.children.filter((c) => c.id !== id) ?? []
    select(siblings[Math.min(at?.index ?? 0, siblings.length - 1)]?.id ?? at?.parent.id ?? root.id)
  }

  /** Gerade angelegten, noch leeren Knoten verwerfen – als wäre nichts passiert */
  function discardNew(id: string) {
    const before = history.current.past.pop()
    commit(before ?? removeNode(root, id), [])
    select(findParent(root, id)?.parent.id ?? root.id)
  }

  function commitText(id: string, text: string, next?: 'child') {
    const clean = cleanNodeText(text)
    const isNew = editing?.id === id && editing.isNew
    setEditing(null)
    // Leere Knoten verschwinden wieder (außer der Wurzel)
    if (!clean && id !== root.id) {
      if (isNew) discardNew(id)
      else remove(id)
      focusFlow()
      return
    }
    const named = setNodeText(root, id, clean || title)
    // Anlegen und Beschriften sind ein Schritt; das Anlegen steht schon im Verlauf
    const record = isNew ? [] : [root]
    if (next !== 'child') {
      commit(named, record)
      focusFlow()
      return
    }
    const child: MindNode = { id: newNodeId(), text: '', children: [] }
    commit(addChild(named, id, child), named === root ? record : [...record, named])
    setSelectedId(child.id)
    setEditing({ id: child.id, initial: '', selectAll: false, isNew: true })
  }

  function cancelEdit(id: string) {
    const isNew = editing?.isNew && editing.id === id
    setEditing(null)
    if (isNew) discardNew(id)
    focusFlow()
  }

  function toggleCollapsed(id: string) {
    setCollapsed((c) => {
      const next = new Set(c)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleTask(id: string) {
    const n = findNode(root, id)
    const m = n ? TASK_RE.exec(n.text) : null
    if (!n || !m) return
    commit(setNodeText(root, id, `[${m[1] === ' ' ? 'x' : ' '}] ${n.text.slice(m[0].length)}`))
  }

  const allCollapsed = collapsed.size > 0
  function toggleAll() {
    if (allCollapsed) return setCollapsed(new Set())
    // Alles bis zur ersten Ebene einklappen
    setCollapsed(new Set(root.children.filter((c) => c.children.length > 0).map((c) => c.id)))
  }

  // ---- Tastatur ----

  function navigate(key: string) {
    const current = selected ?? root
    const placedNode = placed.find((p) => p.node.id === current.id)
    if (!placedNode) return select(root.id)
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      // Sichtbare Nachbarn derselben Seite und Ebene, nach Höhe sortiert
      const row = placed
        .filter((p) => p.depth === placedNode.depth && p.side === placedNode.side)
        .sort((a, b) => a.y - b.y)
      const i = row.indexOf(placedNode) + (key === 'ArrowUp' ? -1 : 1)
      if (row[i]) select(row[i].node.id)
      return
    }
    const towardsChildren = placedNode.side === 'left' ? key === 'ArrowLeft' : key === 'ArrowRight'
    if (placedNode.side === 'root') {
      const side = key === 'ArrowRight' ? 'right' : 'left'
      const first = placed.filter((p) => p.depth === 1 && p.side === side).sort((a, b) => a.y - b.y)[0]
      if (first) select(first.node.id)
    } else if (towardsChildren) {
      if (collapsed.has(current.id)) toggleCollapsed(current.id)
      const kids = placed.filter((p) => p.parentId === current.id).sort((a, b) => a.y - b.y)
      const child = kids[Math.floor((kids.length - 1) / 2)] ?? (collapsed.has(current.id) ? { node: current.children[0] } : null)
      if (child?.node) select(child.node.id)
    } else if (placedNode.parentId) select(placedNode.parentId)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (editing || e.target !== e.currentTarget) return
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      return e.shiftKey ? redo() : undo()
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault()
      return redo()
    }
    if (e.key.startsWith('Arrow')) {
      e.preventDefault()
      if (e.altKey && selected && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        if (!readOnly) commit(shiftNode(root, selected.id, e.key === 'ArrowUp' ? -1 : 1))
        return
      }
      return navigate(e.key)
    }
    if (e.key === 'Escape') return select(null)
    if (readOnly || mod || e.altKey) return
    if (e.key === 'Tab') {
      e.preventDefault()
      return insert('child')
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      return insert('sibling')
    }
    if (!selected) return
    if (e.key === 'F2' || e.key === ' ') {
      e.preventDefault()
      return startEdit(selected.id)
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      return remove(selected.id)
    }
    // Einfach lostippen ersetzt den Text (wie in Mindmap-Programmen üblich)
    if (e.key.length === 1) {
      e.preventDefault()
      startEdit(selected.id, e.key)
    }
  }

  // ---- Maus und Touch ----

  function onNodesChange(changes: NodeChange<MindFlowNode>[]) {
    let nextSizes: Map<string, Size> | null = null
    for (const c of changes) {
      if (c.type === 'dimensions' && c.dimensions) {
        const old = sizes.get(c.id)
        if (old && Math.abs(old.width - c.dimensions.width) < 0.5 && Math.abs(old.height - c.dimensions.height) < 0.5) continue
        nextSizes ??= new Map(sizes)
        nextSizes.set(c.id, { width: c.dimensions.width, height: c.dimensions.height })
      } else if (c.type === 'position' && c.position && c.dragging) {
        setDrag({ id: c.id, x: c.position.x, y: c.position.y })
      }
    }
    if (nextSizes) setSizes(nextSizes)
  }

  function dropTargetFor(node: MindFlowNode): string | null {
    const moving = findNode(root, node.id)
    if (!moving) return null
    const own = new Set(subtreeIds(moving))
    const parentId = findParent(root, node.id)?.parent.id
    const hit = flow
      .getIntersectingNodes(node)
      .filter((n) => !own.has(n.id))
      .sort((a, b) => (a.id === parentId ? 1 : 0) - (b.id === parentId ? 1 : 0))[0]
    return hit?.id ?? null
  }

  // Beim ersten Anzeigen alles einpassen – erst, wenn alle Knoten gemessen und angeordnet sind
  const measured = placed.every((p) => sizes.has(p.node.id))
  const fitted = useRef(false)
  useEffect(() => {
    if (!measured || fitted.current) return
    fitted.current = true
    requestAnimationFrame(() => {
      void flow.fitView({ padding: 0.15, maxZoom: 1 })
      if (wrapperRef.current) wrapperRef.current.dataset.ready = '1'
      if (autoFocus) focusFlow()
    })
  }, [measured, flow, autoFocus])

  // Ausgewählten Knoten ins Bild holen (z. B. nach dem Anlegen am Rand)
  useEffect(() => {
    if (!selectedId || !fitted.current || !wrapperRef.current) return
    const p = placed.find((n) => n.node.id === selectedId)
    if (!p) return
    const { x, y, zoom } = flow.getViewport()
    const { width, height } = wrapperRef.current.getBoundingClientRect()
    const left = p.x * zoom + x
    const top = p.y * zoom + y
    const margin = 24
    if (left < margin || top < margin || left + p.width * zoom > width - margin || top + p.height * zoom > height - margin) {
      void flow.setCenter(p.x + p.width / 2, p.y + p.height / 2, { zoom, duration: 200 })
    }
  }, [selectedId, placed, flow])

  // Ohne Abhängigkeitsliste: Der Handle soll immer den aktuellen Baum sehen
  useImperativeHandle(handleRef, () => ({
      focus: () => focusFlow(),
      setDoc: (markdown) => setDoc({ source: markdown, root: parseMindmap(markdown, title) }),
      insert: (insertion) => {
        // Seitenlink oder Zitat aus dem PDF als Unterpunkt des ausgewählten Knotens
        const link = insertionToMarkdown({ kind: 'page-link', ref: insertion.ref })
        insert('child', cleanNodeText(insertion.kind === 'quote' ? `„${insertion.text}“ ${link}` : link))
      },
      insertAttachment: (att) => insert('child', attachmentMarkdown(att)),
      selectedText: () => (selected && selected.id !== root.id ? selected.text : ''),
  }))

  const ctx: MindContextValue = {
    readOnly,
    selectedId,
    editing,
    dropTargetId,
    links,
    commitText,
    cancelEdit,
    toggleCollapsed,
    toggleTask,
  }

  const canChange = !!selected && selected.id !== root.id

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {readOnly ? null : (
        <div className="border-b border-border">
          <div className="flex items-center gap-0.5 overflow-x-auto px-2 py-1 [scrollbar-width:none]" role="toolbar" aria-label="Mindmap">
            <Tool label="Unterpunkt (Tab)" onClick={() => insert('child')}>
              <ListIndentIncrease />
            </Tool>
            <Tool label="Nächster Punkt (Enter)" onClick={() => insert('sibling')}>
              <CornerDownRight />
            </Tool>
            <Tool label="Bearbeiten (F2)" onClick={() => selected && startEdit(selected.id)} disabled={!selected}>
              <Pencil />
            </Tool>
            <Tool label="Löschen (Entf)" onClick={() => selected && remove(selected.id)} disabled={!canChange}>
              <Trash2 />
            </Tool>
            <Divider />
            <Tool label="Nach oben (Alt+↑)" onClick={() => selected && commit(shiftNode(root, selected.id, -1))} disabled={!canChange}>
              <ArrowUp />
            </Tool>
            <Tool label="Nach unten (Alt+↓)" onClick={() => selected && commit(shiftNode(root, selected.id, 1))} disabled={!canChange}>
              <ArrowDown />
            </Tool>
            <Tool label={allCollapsed ? 'Alles aufklappen' : 'Äste einklappen'} onClick={toggleAll}>
              {allCollapsed ? <ChevronsUpDown /> : <ChevronsDownUp />}
            </Tool>
            <Divider />
            <AttachButtons onUpload={onUpload} />
            <Tool label="Karteikarte aus Knoten" onClick={onCreateCard}>
              <Layers />
            </Tool>
            <Divider />
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
      <MindContext.Provider value={ctx}>
        <div
          ref={wrapperRef}
          className="mindmap-flow flow-surface relative min-h-0 flex-1 outline-none"
          tabIndex={0}
          role="application"
          aria-label="Mindmap – Pfeiltasten wählen Knoten, Tab legt einen Unterpunkt an, Enter einen weiteren Punkt"
          onKeyDown={onKeyDown}
          onPointerDown={(e) => {
            // React Flow verhindert den Fokus beim Klicken – Tastenbefehle sollen trotzdem hier ankommen
            if (!(e.target as HTMLElement).closest('textarea, input, button, a')) focusFlow()
          }}
          data-testid="mindmap"
        >
          <ReactFlow<MindFlowNode, BranchEdge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onNodeClick={(_e, n) => {
              // Klicks ins Textfeld beenden das Bearbeiten nicht; ein zweiter Tipp auf den Knoten beginnt es
              if (editing?.id === n.id) return
              if (selectedId === n.id) startEdit(n.id)
              else select(n.id)
            }}
            onNodeDoubleClick={(_e, n) => startEdit(n.id)}
            onPaneClick={() => select(null)}
            onNodeDrag={(_e, n) => setDropTargetId(dropTargetFor(n))}
            onNodeDragStop={(_e, n) => {
              const target = dropTargetFor(n)
              setDrag(null)
              setDropTargetId(null)
              if (target) {
                commit(moveNode(root, n.id, target))
                setCollapsed((c) => new Set([...c].filter((id) => id !== target)))
              }
              select(n.id)
            }}
            elementsSelectable={false}
            nodesConnectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            deleteKeyCode={null}
            selectionKeyCode={null}
            multiSelectionKeyCode={null}
            zoomOnDoubleClick={false}
            panOnScroll
            minZoom={0.15}
            maxZoom={2.5}
            nodeDragThreshold={4}
            ariaLabelConfig={FLOW_ARIA_LABELS}
            proOptions={FLOW_PRO_OPTIONS}
          >
            <Background variant={BackgroundVariant.Lines} gap={20} />
            <Panel position="bottom-right" className="flow-panel">
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
      </MindContext.Provider>
    </div>
  )
}
