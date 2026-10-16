import type { Metadata } from 'next'
import { SettingsPage } from '@/features/settings/components/SettingsPage'

export const metadata: Metadata = { title: 'Einstellungen' }

export default function Page() {
  return <SettingsPage />
}
