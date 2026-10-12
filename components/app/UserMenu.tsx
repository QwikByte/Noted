'use client'
import Link from 'next/link'
import { ChevronsUpDown, LogOut, Monitor, Moon, Settings, Shield, Sun } from 'lucide-react'
import { useUser } from './AppProviders'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../ui/menu'
import { cn } from '../ui/cn'
import { useTheme, type Theme } from '@/lib/client/prefs'
import { logout } from '@/lib/client/session'
import { sync } from '@/lib/client/sync'

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
  return (
    <span
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-text',
        className,
      )}
    >
      {initials || '?'}
    </span>
  )
}

export async function confirmLogout() {
  if (sync.hasPending() && !confirm('Es gibt noch nicht synchronisierte Änderungen. Beim Abmelden gehen sie verloren. Trotzdem abmelden?')) {
    return
  }
  await logout()
}

export function ThemeSwitch() {
  const [theme, setTheme] = useTheme()
  const options: { value: Theme; icon: React.ReactNode; label: string }[] = [
    { value: 'light', icon: <Sun className="size-4" />, label: 'Hell' },
    { value: 'dark', icon: <Moon className="size-4" />, label: 'Dunkel' },
    { value: 'system', icon: <Monitor className="size-4" />, label: 'System' },
  ]
  return (
    <div className="flex gap-1 rounded-lg bg-subtle p-1" role="radiogroup" aria-label="Design">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={theme === o.value}
          onClick={() => setTheme(o.value)}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors',
            theme === o.value ? 'bg-elevated text-fg shadow-sm' : 'text-muted hover:text-fg',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function UserMenu() {
  const user = useUser()
  return (
    <Menu
      align="left"
      side="top"
      className="w-full min-w-64"
      trigger={(p) => (
        <button
          type="button"
          {...p}
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-hover"
        >
          <Avatar name={user.displayName} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{user.displayName}</span>
            <span className="block truncate text-xs text-faint">
              @{user.username}
              {user.role === 'admin' ? ' · Admin' : ''}
            </span>
          </span>
          <ChevronsUpDown className="size-4 text-faint" />
        </button>
      )}
    >
      <MenuLabel>Design</MenuLabel>
      <div className="px-1.5 pb-1.5">
        <ThemeSwitch />
      </div>
      <MenuSeparator />
      <Link href="/settings" className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-hover">
        <Settings className="size-4 text-muted" /> Einstellungen
      </Link>
      {user.role === 'admin' ? (
        <Link href="/admin" className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-hover">
          <Shield className="size-4 text-muted" /> Administration
        </Link>
      ) : null}
      <MenuSeparator />
      <MenuItem icon={<LogOut />} onSelect={confirmLogout}>
        Abmelden
      </MenuItem>
    </Menu>
  )
}
