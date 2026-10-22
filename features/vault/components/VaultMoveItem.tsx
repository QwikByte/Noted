'use client'
import { Lock, LockOpen } from 'lucide-react'
import { MenuItem } from '@/shared/ui/menu'
import type { NoteSummary } from '@/features/notes/types'
import { useVaultInfo } from '../client/vault'
import { requestVault } from '../client/vault-ui'

/** Menüeintrag „In den Tresor verschieben …“ bzw. „Aus dem Tresor verschieben …“ – nur, wenn es einen Tresor gibt */
export function VaultMoveItem({ note, disabled }: { note: NoteSummary; disabled?: boolean }) {
  const { data: info } = useVaultInfo()
  if (!info) return null
  return (
    <MenuItem
      icon={note.vault ? <LockOpen /> : <Lock />}
      onSelect={() => requestVault({ kind: 'move', note })}
      disabled={disabled}
    >
      {note.vault ? 'Aus dem Tresor verschieben …' : 'In den Tresor verschieben …'}
    </MenuItem>
  )
}
