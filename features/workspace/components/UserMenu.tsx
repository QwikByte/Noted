'use client'
import Link from 'next/link'
import { ChevronsUpDown, LogOut, Settings, Shield } from 'lucide-react'
import { useUser } from '@/features/auth/client/current-user'
import { confirmLogout } from '@/features/auth/client/logout'
import { Avatar } from '@/shared/ui/avatar'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/shared/ui/menu'
import { ThemeSwitch } from '@/shared/ui/theme-switch'

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
