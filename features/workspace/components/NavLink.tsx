'use client'
import { forwardRef } from 'react'
import { useApp } from '../client/context'
import { viewToUrl, type View } from '../client/nav'

type Props = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { to: View }

/**
 * Link auf eine Ansicht der App: ein echtes <a>, damit Strg/⌘-Klick, Mittelklick und „Link kopieren“ wie gewohnt
 * funktionieren. Ein normaler Klick wechselt ohne Neuladen (auch offline).
 */
export const NavLink = forwardRef<HTMLAnchorElement, Props>(function NavLink({ to, onClick, ...props }, ref) {
  const app = useApp()
  return (
    <a
      ref={ref}
      href={viewToUrl(to)}
      // Notizen und Ordner werden mit eigenem Ziehen in Ordner verschoben – nicht als Link in die Adressleiste
      draggable={false}
      onClick={(e) => {
        onClick?.(e)
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        app.go(to)
      }}
      {...props}
    />
  )
})
