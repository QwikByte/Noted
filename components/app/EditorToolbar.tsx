'use client'
import { useRef } from 'react'
import {
  Bold,
  Camera,
  Code,
  Hash,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  MessageSquareQuote,
  Paperclip,
  Redo2,
  Sigma,
  Strikethrough,
  Table,
  TextQuote,
  Undo2,
} from 'lucide-react'
import { redo, undo } from '@codemirror/commands'
import type { EditorView } from '@codemirror/view'
import {
  insertCallout,
  insertCodeBlock,
  insertLink,
  insertMath,
  insertTable,
  insertText,
  setHeading,
  toggleLinePrefix,
  wrapSelection,
} from '@/lib/client/editor/commands'
import { Menu, MenuItem } from '../ui/menu'
import { cn } from '../ui/cn'

function ToolButton({
  label,
  onClick,
  children,
  className,
  ...rest
}: {
  label: string
  onClick?: () => void
  children: React.ReactNode
  className?: string
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      // Fokus im Editor behalten (wichtig auf dem Handy: Tastatur bleibt offen)
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-fg active:bg-active [&>svg]:size-[18px]',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

const Divider = () => <div className="mx-1 h-5 w-px shrink-0 bg-border" />

const CALLOUTS: [string, string][] = [
  ['note', 'Notiz'],
  ['info', 'Info'],
  ['tip', 'Tipp'],
  ['important', 'Wichtig'],
  ['warning', 'Achtung'],
  ['question', 'Frage'],
  ['example', 'Beispiel'],
  ['summary', 'Zusammenfassung'],
  ['quote', 'Zitat'],
]

export function EditorToolbar({
  getView,
  onUpload,
}: {
  getView: () => EditorView | null
  onUpload: (files: File[]) => void
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const run = (fn: (view: EditorView) => void) => () => {
    const view = getView()
    if (view) fn(view)
  }

  return (
    <div
      className="flex items-center gap-0.5 overflow-x-auto px-2 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="toolbar"
      aria-label="Formatierung"
    >
      <Menu
        align="left"
        trigger={(p) => (
          <ToolButton label="Überschrift" {...p}>
            <Heading2 />
          </ToolButton>
        )}
      >
        <MenuItem icon={<Heading1 />} onSelect={run((v) => setHeading(v, 1))}>
          Überschrift 1
        </MenuItem>
        <MenuItem icon={<Heading2 />} onSelect={run((v) => setHeading(v, 2))}>
          Überschrift 2
        </MenuItem>
        <MenuItem icon={<Heading3 />} onSelect={run((v) => setHeading(v, 3))}>
          Überschrift 3
        </MenuItem>
      </Menu>
      <ToolButton label="Fett (Strg+B)" onClick={run((v) => wrapSelection(v, '**', '**', 'fett'))}>
        <Bold />
      </ToolButton>
      <ToolButton label="Kursiv (Strg+I)" onClick={run((v) => wrapSelection(v, '*', '*', 'kursiv'))}>
        <Italic />
      </ToolButton>
      <ToolButton label="Markieren" onClick={run((v) => wrapSelection(v, '==', '==', 'wichtig'))}>
        <Highlighter />
      </ToolButton>
      <ToolButton label="Durchgestrichen" onClick={run((v) => wrapSelection(v, '~~', '~~'))}>
        <Strikethrough />
      </ToolButton>
      <Divider />
      <ToolButton label="Aufzählung" onClick={run((v) => toggleLinePrefix(v, '- '))}>
        <List />
      </ToolButton>
      <ToolButton label="Nummerierte Liste" onClick={run((v) => toggleLinePrefix(v, (i) => `${i + 1}. `))}>
        <ListOrdered />
      </ToolButton>
      <ToolButton label="Aufgabe" onClick={run((v) => toggleLinePrefix(v, '- [ ] '))}>
        <ListChecks />
      </ToolButton>
      <ToolButton label="Zitat" onClick={run((v) => toggleLinePrefix(v, '> '))}>
        <TextQuote />
      </ToolButton>
      <Menu
        align="left"
        trigger={(p) => (
          <ToolButton label="Callout" {...p}>
            <MessageSquareQuote />
          </ToolButton>
        )}
      >
        {CALLOUTS.map(([type, label]) => (
          <MenuItem key={type} onSelect={run((v) => insertCallout(v, type))} hint={type}>
            {label}
          </MenuItem>
        ))}
      </Menu>
      <Divider />
      <ToolButton label="Wikilink [[ ]]" onClick={run(insertLink)}>
        <Link2 />
      </ToolButton>
      <ToolButton label="Tag" onClick={run((v) => insertText(v, '#'))}>
        <Hash />
      </ToolButton>
      <Menu
        align="left"
        trigger={(p) => (
          <ToolButton label="Formel" {...p}>
            <Sigma />
          </ToolButton>
        )}
      >
        <MenuItem onSelect={run((v) => insertMath(v, false))} hint="$…$">
          Formel im Text
        </MenuItem>
        <MenuItem onSelect={run((v) => insertMath(v, true))} hint="$$…$$">
          Formel-Block
        </MenuItem>
      </Menu>
      <ToolButton label="Code" onClick={run(insertCodeBlock)}>
        <Code />
      </ToolButton>
      <ToolButton label="Tabelle" onClick={run(insertTable)}>
        <Table />
      </ToolButton>
      <Divider />
      <ToolButton label="Datei anhängen" onClick={() => fileInput.current?.click()}>
        <Paperclip />
      </ToolButton>
      <ToolButton label="Foto aufnehmen" onClick={() => cameraInput.current?.click()} className="sm:hidden">
        <Camera />
      </ToolButton>
      <Divider />
      <ToolButton label="Rückgängig" onClick={run((v) => undo(v))}>
        <Undo2 />
      </ToolButton>
      <ToolButton label="Wiederholen" onClick={run((v) => redo(v))}>
        <Redo2 />
      </ToolButton>

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (files.length) onUpload(files)
        }}
      />
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (files.length) onUpload(files)
        }}
      />
    </div>
  )
}
