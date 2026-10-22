'use client'
// Anfragen an die Dialoge des Tresors (Entsperren, Verschieben) – aus Ordnerbaum, Menüs und Ziehen heraus, ohne dass
// jede Stelle die Dialoge selbst mitbringt. Angezeigt werden sie von VaultDialogs im App-Rahmen.
import { useSyncExternalStore } from 'react'
import type { NoteSummary } from '@/features/notes/types'

type VaultRequest =
  | { kind: 'unlock'; then?: () => void }
  /** Über die Grenze verschieben – `folderId`: vorgeschlagenes Ziel (z. B. beim Ziehen) */
  | { kind: 'move'; note: NoteSummary; folderId?: string | null }

let current: VaultRequest | null = null
const listeners = new Set<() => void>()

export function requestVault(request: VaultRequest | null) {
  current = request
  for (const fn of listeners) fn()
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function useVaultRequest(): VaultRequest | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  )
}
