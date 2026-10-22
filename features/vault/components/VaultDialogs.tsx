'use client'
// Dialoge des Tresors im App-Rahmen – geöffnet über requestVault() aus Ordnerbaum, Menüs und Ziehen
import { useVaultState } from '../client/vault'
import { requestVault, useVaultRequest } from '../client/vault-ui'
import { MoveToVaultDialog } from './MoveToVaultDialog'
import { VaultUnlockDialog } from './VaultUnlockDialog'

export function VaultDialogs() {
  const request = useVaultRequest()
  const { unlocked } = useVaultState()
  if (!request) return null
  const close = () => requestVault(null)
  // Verschieben geht nur entsperrt – danach erscheint der Dialog dazu von selbst
  if (request.kind === 'unlock' || !unlocked) {
    return (
      <VaultUnlockDialog
        onClose={close}
        onUnlocked={() => {
          if (request.kind !== 'unlock') return
          close()
          request.then?.()
        }}
      />
    )
  }
  return <MoveToVaultDialog note={request.note} folderId={request.folderId} onClose={close} />
}
