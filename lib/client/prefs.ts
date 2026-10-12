'use client'
import { useCallback, useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark' | 'system'
export type EditorMode = 'edit' | 'read' | 'split'

const listeners = new Set<() => void>()

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* privat/voll */
  }
  for (const fn of listeners) fn()
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  const onStorage = () => fn()
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(fn)
    window.removeEventListener('storage', onStorage)
  }
}

export function usePref<T extends string>(key: string, fallback: T): [T, (v: T) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => (read(key) as T | null) ?? fallback,
    () => fallback,
  )
  const set = useCallback((v: T) => write(key, v), [key])
  return [value, set]
}

export function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = usePref<Theme>('noted:theme', 'system')
  return [
    theme,
    (t: Theme) => {
      setTheme(t)
      applyTheme(t)
    },
  ]
}

export function useFontSize(): [number, (n: number) => void] {
  const [size, setSize] = usePref<string>('noted:fontSize', '16')
  return [
    Number(size) || 16,
    (n: number) => {
      setSize(String(n))
      document.documentElement.style.setProperty('--editor-font-size', `${n}px`)
    },
  ]
}

export function isDarkMode() {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
}
