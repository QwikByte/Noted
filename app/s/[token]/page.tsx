import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { loadSharedPage } from '@/features/sharing/server/shares'
import { SharedNote } from '@/features/sharing/components/SharedNote'

export async function generateMetadata(props: PageProps<'/s/[token]'>): Promise<Metadata> {
  const note = await loadSharedPage((await props.params).token)
  return { title: note && note !== 'limited' ? note.title : 'Nicht gefunden' }
}

/** Notiz, die jemand per Link geteilt hat – nur lesen */
export default async function SharedPage(props: PageProps<'/s/[token]'>) {
  const { token } = await props.params
  const note = await loadSharedPage(token)
  if (!note) notFound()
  return <SharedNote token={token} note={note === 'limited' ? null : note} />
}
