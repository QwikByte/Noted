'use client'
import { useId, useLayoutEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from './cn'
import { Button } from './button'

/**
 * Schließen per Klick auf den Hintergrund eines <dialog>. Der Klick muss dort auch begonnen haben: Wer Text im
 * Dialog markiert und die Maus außerhalb loslässt, löst sonst ebenfalls einen Klick auf den Hintergrund aus – und
 * verliert, was er eingetippt hat.
 */
export function useBackdropPress(ref: React.RefObject<HTMLDialogElement | null>) {
  const pressed = useRef(false)
  return (onClose: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      pressed.current = e.target === ref.current
    },
    onClick: (e: React.MouseEvent) => {
      if (pressed.current && e.target === ref.current) onClose()
      pressed.current = false
    },
  })
}

/** Dialog auf Basis von <dialog> (Fokusfalle, Escape, oberste Ebene). */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  className,
}: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  footer?: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  const backdropPress = useBackdropPress(ref)
  // Inhalt erst einhängen, wenn der Dialog offen ist: Sonst greift autoFocus darin nicht – das Feld wäre beim
  // Einhängen noch unsichtbar, und showModal() setzte den Fokus danach auf den ersten Knopf („Schließen“)
  const [shown, setShown] = useState(false)

  useLayoutEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
    setShown(open)
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-description` : undefined}
      onCancel={(e) => {
        e.preventDefault()
        // React reicht onCancel an umgebende Dialoge weiter: Escape in einer Rückfrage schlösse sonst auch den Dialog,
        // aus dem sie kommt
        e.stopPropagation()
        onClose()
      }}
      {...backdropPress(onClose)}
      className={cn(
        'm-auto w-[calc(100%-1.5rem)] max-h-[calc(100dvh-2rem)] overflow-hidden overscroll-contain rounded-2xl border border-border bg-elevated p-0 text-fg shadow-pop backdrop:bg-black/40 backdrop:backdrop-blur-[2px] open:animate-pop-in open:backdrop:animate-fade-in',
        size === 'sm' && 'max-w-sm',
        size === 'md' && 'max-w-lg',
        size === 'lg' && 'max-w-2xl',
        size === 'xl' && 'max-w-5xl',
        className,
      )}
    >
      {open && shown ? (
        <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
          <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
            <div className="min-w-0">
              <h2 id={`${id}-title`} className="text-lg font-semibold break-words">
                {title}
              </h2>
              {description ? (
                <p id={`${id}-description`} className="mt-1 text-sm break-words text-muted">
                  {description}
                </p>
              ) : null}
            </div>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Schließen" className="-mr-1.5 -mt-1">
              <X className="size-4.5" />
            </Button>
          </div>
          {children ? <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">{children}</div> : null}
          {footer ? (
            <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-subtle px-5 py-3">{footer}</div>
          ) : null}
        </div>
      ) : null}
    </dialog>
  )
}

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Bestätigen',
  danger,
  loading,
  children,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  description?: React.ReactNode
  confirmLabel?: string
  danger?: boolean
  loading?: boolean
  children?: React.ReactNode
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  )
}
