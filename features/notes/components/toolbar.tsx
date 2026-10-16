'use client'
// Bausteine der Editor-Werkzeugleisten (Markdown und formatierter Text)
import { useRef } from 'react'
import { Camera, Paperclip } from 'lucide-react'
import { cn } from '@/shared/ui/cn'

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
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length) onUpload(files)
  }
  return (
    <>
      <ToolButton label="Datei anhängen" onClick={() => fileInput.current?.click()}>
        <Paperclip />
      </ToolButton>
      <ToolButton label="Foto aufnehmen" onClick={() => cameraInput.current?.click()} className="sm:hidden">
        <Camera />
      </ToolButton>
      <input ref={fileInput} type="file" multiple hidden onChange={pick} />
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
    </>
  )
}
