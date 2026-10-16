'use client'
import { useState } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  Code,
  Highlighter,
  Italic,
  Layers,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Plus,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Table,
  TextQuote,
  Underline,
  Undo2,
  type LucideIcon,
} from 'lucide-react'
import { AttachButtons, Divider, ToolButton } from './toolbar'
import { Menu, MenuItem, MenuSeparator } from '@/shared/ui/menu'
import { Modal } from '@/shared/ui/modal'
import { Button } from '@/shared/ui/button'
import { Field, Input } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'

const STYLES = [
  { id: 'paragraph', label: 'Text', className: 'text-sm' },
  { id: 'h1', label: 'Überschrift 1', className: 'text-lg font-bold' },
  { id: 'h2', label: 'Überschrift 2', className: 'text-base font-bold' },
  { id: 'h3', label: 'Überschrift 3', className: 'text-sm font-bold' },
] as const

// Relativ zur eingestellten Schriftgröße, damit „Einstellungen → Schriftgröße“ weiter wirkt
const SIZES = [
  { value: '0.85em', label: 'Klein' },
  { value: null, label: 'Normal' },
  { value: '1.25em', label: 'Groß' },
  { value: '1.6em', label: 'Sehr groß' },
]

// Kräftige Töne, die auf hellem und dunklem Hintergrund lesbar bleiben
const TEXT_COLORS = [
  { value: '#e03131', label: 'Rot' },
  { value: '#e8590c', label: 'Orange' },
  { value: '#2f9e44', label: 'Grün' },
  { value: '#1c7ed6', label: 'Blau' },
  { value: '#9c36b5', label: 'Violett' },
  { value: '#868e96', label: 'Grau' },
]

const ALIGN_ICONS: Record<string, LucideIcon> = { center: AlignCenter, right: AlignRight, justify: AlignJustify }

const HIGHLIGHTS = [
  { value: '#fff3a3', label: 'Gelb' },
  { value: '#c3fae8', label: 'Grün' },
  { value: '#d0ebff', label: 'Blau' },
  { value: '#ffdeeb', label: 'Rosa' },
  { value: '#ffe8cc', label: 'Orange' },
]

function Swatch({ color }: { color: string | null }) {
  return (
    <span
      className={cn('size-4 shrink-0 rounded-full border border-border-strong', !color && 'bg-[linear-gradient(135deg,transparent_45%,var(--danger)_45%,var(--danger)_55%,transparent_55%)]')}
      style={color ? { background: color } : undefined}
    />
  )
}

/** Werkzeugleiste für formatierten Text – wie in einer Textverarbeitung */
export function RichTextToolbar({
  editor,
  onUpload,
  onCreateCard,
}: {
  editor: Editor
  onUpload: (files: File[]) => void
  onCreateCard: () => void
}) {
  const [linkOpen, setLinkOpen] = useState(false)
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      style: e.isActive('heading', { level: 1 })
        ? 'h1'
        : e.isActive('heading', { level: 2 })
          ? 'h2'
          : e.isActive('heading', { level: 3 })
            ? 'h3'
            : 'paragraph',
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      highlight: e.isActive('highlight'),
      color: (e.getAttributes('textStyle').color as string | undefined) ?? null,
      align: (['center', 'right', 'justify'] as const).find((a) => e.isActive({ textAlign: a })) ?? 'left',
      bulletList: e.isActive('bulletList'),
      orderedList: e.isActive('orderedList'),
      taskList: e.isActive('taskList'),
      blockquote: e.isActive('blockquote'),
      codeBlock: e.isActive('codeBlock'),
      link: e.isActive('link'),
      table: e.isActive('table'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  })

  const chain = () => editor.chain().focus()
  const setStyle = (id: (typeof STYLES)[number]['id']) => {
    if (id === 'paragraph') chain().setParagraph().run()
    else chain().setHeading({ level: Number(id[1]) as 1 | 2 | 3 }).run()
  }
  const AlignIcon = ALIGN_ICONS[state.align] ?? AlignLeft
  const currentStyle = STYLES.find((s) => s.id === state.style) ?? STYLES[0]

  return (
    // Auf dem Handy seitlich scrollen, auf breiten Bildschirmen umbrechen (wie das Menüband einer Textverarbeitung)
    <div
      className="flex items-center gap-0.5 overflow-x-auto px-2 py-1 [scrollbar-width:none] sm:flex-wrap sm:justify-center sm:overflow-visible [&::-webkit-scrollbar]:hidden"
      role="toolbar"
      aria-label="Formatierung"
    >
      <ToolButton label="Rückgängig" onClick={() => chain().undo().run()} disabled={!state.canUndo}>
        <Undo2 />
      </ToolButton>
      <ToolButton label="Wiederholen" onClick={() => chain().redo().run()} disabled={!state.canRedo}>
        <Redo2 />
      </ToolButton>
      <Divider />
      <Menu
        align="left"
        keepFocus
        trigger={(p) => (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            className="flex h-9 w-32 shrink-0 items-center justify-between gap-1 rounded-lg px-2.5 text-sm text-muted hover:bg-hover hover:text-fg"
            aria-label="Absatzformat"
            title="Absatzformat"
            {...p}
          >
            <span className="truncate">{currentStyle.label}</span>
            <span aria-hidden>▾</span>
          </button>
        )}
      >
        {STYLES.map((s) => (
          <MenuItem key={s.id} onSelect={() => setStyle(s.id)}>
            <span className={s.className}>{s.label}</span>
          </MenuItem>
        ))}
      </Menu>
      <Menu
        align="left"
        keepFocus
        trigger={(p) => (
          <ToolButton label="Schriftgröße" {...p}>
            <span className="text-[13px] font-semibold">
              A<span className="text-[10px]">A</span>
            </span>
          </ToolButton>
        )}
      >
        {SIZES.map((s) => (
          <MenuItem
            key={s.label}
            onSelect={() => (s.value ? chain().setFontSize(s.value).run() : chain().unsetFontSize().run())}
          >
            <span style={s.value ? { fontSize: s.value } : undefined}>{s.label}</span>
          </MenuItem>
        ))}
      </Menu>
      <Divider />
      <ToolButton label="Fett (Strg+B)" active={state.bold} onClick={() => chain().toggleBold().run()}>
        <Bold />
      </ToolButton>
      <ToolButton label="Kursiv (Strg+I)" active={state.italic} onClick={() => chain().toggleItalic().run()}>
        <Italic />
      </ToolButton>
      <ToolButton label="Unterstrichen (Strg+U)" active={state.underline} onClick={() => chain().toggleUnderline().run()}>
        <Underline />
      </ToolButton>
      <ToolButton label="Durchgestrichen" active={state.strike} onClick={() => chain().toggleStrike().run()}>
        <Strikethrough />
      </ToolButton>
      <Menu
        align="left"
        keepFocus
        trigger={(p) => (
          <ToolButton label="Schriftfarbe" {...p}>
            <Baseline style={state.color ? { color: state.color } : undefined} />
          </ToolButton>
        )}
      >
        <MenuItem icon={<Swatch color={null} />} onSelect={() => chain().unsetColor().run()}>
          Standard
        </MenuItem>
        {TEXT_COLORS.map((c) => (
          <MenuItem key={c.value} icon={<Swatch color={c.value} />} onSelect={() => chain().setColor(c.value).run()}>
            {c.label}
          </MenuItem>
        ))}
      </Menu>
      <Menu
        align="left"
        keepFocus
        trigger={(p) => (
          <ToolButton label="Hervorheben" active={state.highlight} {...p}>
            <Highlighter />
          </ToolButton>
        )}
      >
        <MenuItem icon={<Swatch color={null} />} onSelect={() => chain().unsetHighlight().run()}>
          Keine
        </MenuItem>
        {HIGHLIGHTS.map((c) => (
          <MenuItem key={c.value} icon={<Swatch color={c.value} />} onSelect={() => chain().setHighlight({ color: c.value }).run()}>
            {c.label}
          </MenuItem>
        ))}
      </Menu>
      <Divider />
      <Menu
        align="left"
        keepFocus
        trigger={(p) => (
          <ToolButton label="Ausrichtung" {...p}>
            <AlignIcon />
          </ToolButton>
        )}
      >
        <MenuItem icon={<AlignLeft />} onSelect={() => chain().setTextAlign('left').run()}>
          Linksbündig
        </MenuItem>
        <MenuItem icon={<AlignCenter />} onSelect={() => chain().setTextAlign('center').run()}>
          Zentriert
        </MenuItem>
        <MenuItem icon={<AlignRight />} onSelect={() => chain().setTextAlign('right').run()}>
          Rechtsbündig
        </MenuItem>
        <MenuItem icon={<AlignJustify />} onSelect={() => chain().setTextAlign('justify').run()}>
          Blocksatz
        </MenuItem>
      </Menu>
      <ToolButton label="Aufzählung" active={state.bulletList} onClick={() => chain().toggleBulletList().run()}>
        <List />
      </ToolButton>
      <ToolButton label="Nummerierte Liste" active={state.orderedList} onClick={() => chain().toggleOrderedList().run()}>
        <ListOrdered />
      </ToolButton>
      <ToolButton label="Aufgabenliste" active={state.taskList} onClick={() => chain().toggleTaskList().run()}>
        <ListChecks />
      </ToolButton>
      <Divider />
      <ToolButton label="Link" active={state.link} onClick={() => setLinkOpen(true)}>
        <Link2 />
      </ToolButton>
      <Menu
        align="left"
        keepFocus
        trigger={(p) => (
          <ToolButton label="Einfügen" active={state.blockquote || state.codeBlock} {...p}>
            <Plus />
          </ToolButton>
        )}
      >
        <MenuItem icon={<TextQuote />} onSelect={() => chain().toggleBlockquote().run()}>
          Zitat
        </MenuItem>
        <MenuItem icon={<Code />} onSelect={() => chain().toggleCodeBlock().run()}>
          Code-Block
        </MenuItem>
        <MenuItem icon={<Minus />} onSelect={() => chain().setHorizontalRule().run()}>
          Trennlinie
        </MenuItem>
        <MenuItem icon={<Table />} onSelect={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
          Tabelle
        </MenuItem>
      </Menu>
      {state.table ? (
        <Menu
          align="left"
          keepFocus
          trigger={(p) => (
            <ToolButton label="Tabelle bearbeiten" active {...p}>
              <Table />
            </ToolButton>
          )}
        >
          <MenuItem onSelect={() => chain().addRowAfter().run()}>Zeile darunter einfügen</MenuItem>
          <MenuItem onSelect={() => chain().addColumnAfter().run()}>Spalte rechts einfügen</MenuItem>
          <MenuItem onSelect={() => chain().deleteRow().run()}>Zeile löschen</MenuItem>
          <MenuItem onSelect={() => chain().deleteColumn().run()}>Spalte löschen</MenuItem>
          <MenuSeparator />
          <MenuItem danger onSelect={() => chain().deleteTable().run()}>
            Tabelle löschen
          </MenuItem>
        </Menu>
      ) : null}
      <ToolButton label="Formatierung entfernen" onClick={() => chain().unsetAllMarks().clearNodes().run()}>
        <RemoveFormatting />
      </ToolButton>
      <Divider />
      <AttachButtons onUpload={onUpload} />
      <ToolButton label="Karteikarte aus Markierung" onClick={onCreateCard}>
        <Layers />
      </ToolButton>

      <LinkDialog
        open={linkOpen}
        initial={(editor.getAttributes('link').href as string | undefined) ?? ''}
        onClose={() => setLinkOpen(false)}
        onSave={(href) => {
          setLinkOpen(false)
          if (!href) chain().extendMarkRange('link').unsetLink().run()
          else if (editor.state.selection.empty && !state.link) chain().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run()
          else chain().extendMarkRange('link').setLink({ href }).run()
        }}
      />
    </div>
  )
}

function LinkDialog({
  open,
  initial,
  onClose,
  onSave,
}: {
  open: boolean
  initial: string
  onClose: () => void
  onSave: (href: string) => void
}) {
  const [value, setValue] = useState(initial)
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setValue(initial)
  }
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const href = value.trim()
    onSave(href && !/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(href) ? `https://${href}` : href)
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Link"
      size="sm"
      footer={
        <>
          {initial ? (
            <Button variant="ghost" onClick={() => onSave('')}>
              Link entfernen
            </Button>
          ) : null}
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" type="submit" form="link-form">
            Übernehmen
          </Button>
        </>
      }
    >
      <form id="link-form" onSubmit={submit}>
        <Field label="Adresse">
          {(id) => <Input id={id} value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://…" autoFocus inputMode="url" />}
        </Field>
      </form>
    </Modal>
  )
}
