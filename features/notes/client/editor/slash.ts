'use client'
// Befehle mit „/“ im Markdown-Editor – als letzter Zweig der vorhandenen Autovervollständigung, damit dasselbe Menü
// erscheint wie bei [[Links]] und #Tags
import { MapMode, Prec, StateEffect, StateField, type Extension } from '@codemirror/state'
import { keymap, type EditorView } from '@codemirror/view'
import {
  closeCompletion,
  completionStatus,
  pickedCompletion,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import {
  insertBlock,
  insertCodeBlock,
  insertLink,
  insertMath,
  insertTable,
  insertText,
  setHeading,
  toggleLinePrefix,
} from './commands'
import { filterSlashCommands, markdownSlashAt, type SlashCommandId } from '../../slash-commands'
import { formatDate } from '../../templates'
import { pickFiles } from '../pick-files'

type SlashOptions = { onFiles: (files: File[]) => void }

const MERMAID = '```mermaid\nflowchart TD\n    A --> B\n```'

const ACTIONS: Record<SlashCommandId, (view: EditorView, opts: SlashOptions) => void> = {
  h1: (v) => setHeading(v, 1),
  h2: (v) => setHeading(v, 2),
  h3: (v) => setHeading(v, 3),
  bullet: (v) => toggleLinePrefix(v, '- '),
  ordered: (v) => toggleLinePrefix(v, (i) => `${i + 1}. `),
  task: (v) => toggleLinePrefix(v, '- [ ] '),
  quote: (v) => toggleLinePrefix(v, '> '),
  // Den Typ wählt man danach in den vorhandenen Vorschlägen nach „> [!“
  callout: (v) => {
    insertBlock(v, '> [!', 4)
    startCompletion(v)
  },
  table: insertTable,
  math: (v) => insertMath(v, false),
  mathBlock: (v) => insertMath(v, true),
  code: insertCodeBlock,
  mermaid: (v) => insertBlock(v, MERMAID, MERMAID.indexOf('A --> B') + 'A --> B'.length),
  // „---“ in Zeile 1 wäre der Beginn von Properties
  divider: (v) => insertBlock(v, v.state.doc.lineAt(v.state.selection.main.head).number === 1 ? '***' : '---'),
  wikilink: (v) => {
    insertLink(v)
    startCompletion(v)
  },
  // Eigene Zeile, damit „Karteikarten aus Notiz“ die Karte erkennt – „Frage“ ist markiert zum Überschreiben
  flashcard: (v) => {
    const line = v.state.doc.lineAt(v.state.selection.main.head)
    if (line.text.trim()) insertText(v, '\nFrage::Antwort', 1, 5)
    else insertText(v, 'Frage::Antwort', 0, 5)
  },
  date: (v) => insertText(v, formatDate(new Date(), 'YYYY-MM-DD')),
  // Der Dateidialog muss noch im Tasten- bzw. Klickereignis aufgehen
  file: (_v, opts) =>
    void pickFiles().then((files) => {
      if (files.length) opts.onFiles(files)
    }),
}

/** Menü an der Stelle des „/“ – mit leerem Filter alle Befehle, sonst die passenden; ohne Treffer kein Menü */
export function slashCompletion(ctx: CompletionContext, opts: SlashOptions): CompletionResult | null {
  // Günstige Vorprüfung, bevor das ganze Dokument auf Code, Formeln und Properties geprüft wird
  if (!ctx.matchBefore(/(?:^|\s)\/[\p{L}\p{N}]*$/u)) return null
  const match = markdownSlashAt(ctx.state.doc.toString(), ctx.pos)
  if (!match || ctx.state.field(dismissed, false) === match.from) return null
  const commands = filterSlashCommands(match.query, { richText: false })
  if (commands.length === 0) return null
  const options: Completion[] = commands.map((cmd) => ({
    label: cmd.label,
    detail: cmd.hint,
    type: 'keyword',
    apply: (view, completion, from, to) => {
      // Erst „/befehl“ entfernen, dann der Befehl wie in der Werkzeugleiste
      view.dispatch({ changes: { from, to }, annotations: pickedCompletion.of(completion), userEvent: 'input.complete' })
      ACTIONS[cmd.id](view, opts)
    },
  }))
  // Kein validFor: Die Quelle läuft bei jedem Zeichen neu und filtert selbst
  return { from: match.from, options, filter: false }
}

const dismiss = StateEffect.define<number>()

/** Position eines „/“, dessen Menü mit Esc geschlossen wurde – fällt weg, sobald das „/“ gelöscht ist */
const dismissed = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(dismiss)) return e.value
    if (value === null || !tr.docChanged) return value
    const after = tr.changes.mapPos(value + 1, -1, MapMode.TrackBefore)
    return after === null ? null : after - 1
  },
})

/** Vor autocompletion(…) einbinden – sonst schließt dessen eigenes Esc, ohne dass das „/“ gemerkt wird */
export function slashExtensions(): Extension[] {
  return [
    dismissed,
    Prec.highest(
      keymap.of([
        {
          key: 'Escape',
          run: (view) => {
            if (completionStatus(view.state) !== 'active') return false
            const match = markdownSlashAt(view.state.doc.toString(), view.state.selection.main.head)
            if (!match) return false
            view.dispatch({ effects: dismiss.of(match.from) })
            closeCompletion(view)
            return true
          },
        },
      ]),
    ),
  ]
}
