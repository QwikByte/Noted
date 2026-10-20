// Geteilte Notiz für Gäste: Titel und Rahmen kommen vom Server, der Inhalt wird im Browser gerendert und bereinigt
import { Logo } from '@/shared/ui/logo'
import { SharedContent } from './SharedContent'
import type { SharedNote as SharedNoteData } from '../types'

/** `note` null: zu viele Aufrufe von dieser Adresse */
export function SharedNote({ token, note }: { token: string; note: SharedNoteData | null }) {
  return (
    <main className="shared-note mx-auto max-w-[48rem] px-1 pt-8 pb-16 sm:pt-12">
      <header className="px-5">
        <p className="mb-3 flex items-center gap-2 text-xs font-medium text-faint">
          <Logo className="size-5" /> Geteilt aus Noted
        </p>
        {note ? (
          <h1 className="text-[1.75rem] leading-tight font-bold tracking-tight break-words" data-testid="shared-title">
            {note.title}
          </h1>
        ) : (
          <h1 className="text-xl font-bold">Zu viele Aufrufe – bitte versuche es in einer Minute noch einmal.</h1>
        )}
      </header>
      {note ? <SharedContent token={token} note={note} /> : null}
    </main>
  )
}
