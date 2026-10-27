'use client'
import {
  Bold,
  Code,
  Hash,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  Layers,
  Sparkles,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  MessageSquareQuote,
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
} from '../client/editor/commands'
import { Menu, MenuItem } from '@/shared/ui/menu'
import { AttachButtons, Divider, ToolButton } from './toolbar'

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
  onCreateCard,
  onAi,
}: {
  getView: () => EditorView | null
  onUpload: (files: File[]) => void
  /** Karteikarte aus der Markierung erstellen */
  onCreateCard: () => void
  /** KI-Assistent öffnen – nur, wenn die KI eingerichtet ist */
  onAi?: () => void
}) {
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
      <AttachButtons onUpload={onUpload} />
      <ToolButton label="Karteikarte aus Markierung" onClick={onCreateCard}>
        <Layers />
      </ToolButton>
      {onAi ? (
        <ToolButton label="KI-Assistent (Strg+J)" onClick={onAi}>
          <Sparkles />
        </ToolButton>
      ) : null}
      <Divider />
      <ToolButton label="Rückgängig" onClick={run((v) => undo(v))}>
        <Undo2 />
      </ToolButton>
      <ToolButton label="Wiederholen" onClick={run((v) => redo(v))}>
        <Redo2 />
      </ToolButton>
    </div>
  )
}
