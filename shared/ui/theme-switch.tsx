'use client'
import { Monitor, Moon, Sun } from 'lucide-react'
import { cn } from './cn'
import { useTheme, type Theme } from '@/shared/client/prefs'

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
