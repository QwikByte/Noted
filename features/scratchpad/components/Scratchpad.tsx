'use client'
// Fensterinhalt des Schmierzettels: Textfeld, Stand der Synchronisierung und die Knöpfe zum Übernehmen
import { Eraser, FilePlus2, TextCursorInput } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { useToast } from '@/shared/ui/toast'
import { usePref } from '@/shared/client/prefs'
import { useNow } from '@/shared/client/now'
import { formatRelative } from '@/shared/lib/format'
import { getActiveEditor } from '@/features/notes/client/active-editor'
import { sync } from '@/features/notes/client/sync'
import { viewToUrl } from '@/features/workspace/client/nav'
import { scratchpad, useScratchpad, type ScratchpadState } from '../client/scratchpad'
import { appendText, scratchpadNoteTitle } from '../scratchpad'
import { MAX_SCRATCHPAD_LENGTH } from '../limits'

/** Alten Text wieder einsetzen – wurde inzwischen Neues geschrieben, kommt der alte davor */
const restore = (previous: string) => scratchpad.set(appendText(previous, scratchpad.getSnapshot().content))

/** Notiz öffnen – in der App ohne Neuladen (auch offline), aus Einstellungen und Administration per Seitenwechsel */
function openNote(id: string) {
  const url = viewToUrl({ kind: 'note', id })
  if (location.pathname === '/') window.history.pushState(null, '', url)
  else location.assign(url)
}

function statusText(state: ScratchpadState, now: number): string {
  if (state.status === 'error') return state.error ?? 'Speichern fehlgeschlagen.'
  if (state.status === 'offline') return 'Offline – lokal gesichert'
  if (state.dirty || state.status === 'saving') return 'Speichert …'
  return state.updatedAt ? `Gespeichert · ${formatRelative(state.updatedAt, now)}` : ''
}

export function Scratchpad() {
  const state = useScratchpad()
  const toast = useToast()
  const now = useNow(30_000)
  const [spellcheck] = usePref<'1' | '0'>('noted:spellcheck', '1')
  const text = state.content.trim()
  const length = state.content.length

  function insertIntoNote() {
    const editor = getActiveEditor()
    if (!editor) {
      toast.show('Öffne zuerst eine Notiz, um etwas einzufügen.')
      return
    }
    const previous = state.content
    editor.insert({ kind: 'text', text })
    scratchpad.set('')
    toast.show(`In „${editor.title}“ eingefügt – Schmierzettel geleert.`, {
      tone: 'success',
      action: { label: 'Zurückholen', onClick: () => restore(previous) },
    })
  }

  function createNote() {
    const id = crypto.randomUUID()
    const title = scratchpadNoteTitle(text)
    // Auch offline: Die Notiz entsteht als Entwurf und geht mit der nächsten Verbindung an den Server
    void sync.create({ id, title, folderId: null, content: text + '\n', format: 'markdown' })
    scratchpad.set('')
    toast.show(`Notiz „${title}“ angelegt.`, { tone: 'success', action: { label: 'Öffnen', onClick: () => openNote(id) } })
  }

  function clear() {
    const previous = state.content
    scratchpad.set('')
    toast.show('Schmierzettel geleert.', { action: { label: 'Rückgängig', onClick: () => restore(previous) } })
  }

  return (
    <div className="space-y-2 p-3">
      <textarea
        data-autofocus
        aria-label="Schmierzettel"
        placeholder="Kurz etwas notieren – zählt nicht als Notiz"
        rows={8}
        maxLength={MAX_SCRATCHPAD_LENGTH}
        value={state.content}
        onChange={(e) => scratchpad.set(e.target.value)}
        spellCheck={spellcheck === '1'}
        lang="de"
        autoCapitalize="sentences"
        className="block max-h-[50dvh] w-full resize-y rounded-lg border border-border-strong/70 bg-elevated px-3.5 py-2.5 text-[15px] text-fg outline-none transition placeholder:text-faint focus:border-accent focus:ring-3 focus:ring-accent/20"
      />
      {state.merged ? (
        <p role="status" className="text-xs text-muted">
          Mit dem Stand eines anderen Geräts zusammengeführt.
        </p>
      ) : null}
      <div className="flex items-center gap-1">
        {/* Bewusst keine Live-Region: Sonst würde beim Tippen jedes Speichern angesagt */}
        <p
          data-testid="scratchpad-status"
          className={cn('min-w-0 flex-1 truncate text-xs', state.status === 'error' ? 'text-danger' : 'text-faint')}
          title={state.status === 'error' ? state.error : undefined}
        >
          {statusText(state, now)}
          {length >= MAX_SCRATCHPAD_LENGTH * 0.9
            ? ` · ${length.toLocaleString('de-DE')} / ${MAX_SCRATCHPAD_LENGTH.toLocaleString('de-DE')} Zeichen`
            : ''}
        </p>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={insertIntoNote}
          disabled={!text}
          aria-label="In offene Notiz einfügen"
          title="In offene Notiz einfügen"
        >
          <TextCursorInput className="size-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={createNote} disabled={!text} aria-label="Als neue Notiz" title="Als neue Notiz">
          <FilePlus2 className="size-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={clear} disabled={!text} aria-label="Leeren" title="Leeren">
          <Eraser className="size-4" />
        </Button>
      </div>
    </div>
  )
}
