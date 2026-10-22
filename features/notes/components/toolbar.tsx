'use client'
// Bausteine der Editor-Werkzeugleisten (Markdown und formatierter Text)
import { Camera, Paperclip } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import { pickFiles } from '../client/pick-files'

export function ToolButton({
  label,
  onClick,
  children,
  className,
  active,
  keepFocus = true,
  ...rest
}: {
  label: string
  onClick?: () => void
  children: React.ReactNode
  className?: string
  /** Formatierung an der Cursorposition aktiv (z. B. fett) */
  active?: boolean
  /** Fokus im Editor behalten – aus, wenn ein offenes Textfeld beim Klicken erst speichern soll (Mindmap, Canvas) */
  keepFocus?: boolean
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      // Fokus im Editor behalten (wichtig auf dem Handy: Tastatur bleibt offen)
      onMouseDown={keepFocus ? (e) => e.preventDefault() : undefined}
      onClick={onClick}
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-fg active:bg-active [&>svg]:size-[18px]',
        active && 'bg-active text-fg',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

export const Divider = () => <div className="mx-1 h-5 w-px shrink-0 bg-border" />

/** Datei anhängen und (auf dem Handy) direkt ein Foto aufnehmen */
export function AttachButtons({ onUpload }: { onUpload: (files: File[]) => void }) {
  const pick = (opts?: { accept: string; capture: string }) =>
    void pickFiles(opts).then((files) => {
      if (files.length) onUpload(files)
    })
  return (
    <>
      <ToolButton label="Datei anhängen" onClick={() => pick()}>
        <Paperclip />
      </ToolButton>
      <ToolButton label="Foto aufnehmen" onClick={() => pick({ accept: 'image/*', capture: 'environment' })} className="sm:hidden">
        <Camera />
      </ToolButton>
    </>
  )
}
