'use client'
import { usePref } from '@/shared/client/prefs'
import { NOTE_FORMAT_IDS } from '../format'
import type { NoteFormat } from '../types'

/** Zuletzt im Dialog „Neue Notiz“ gewähltes Format – gilt auch für schnell angelegte Notizen */
export function useDefaultNoteFormat(): [NoteFormat, (format: NoteFormat) => void] {
  const [value, set] = usePref<NoteFormat>('noted:noteFormat', 'markdown')
  return [NOTE_FORMAT_IDS.includes(value) ? value : 'markdown', set]
}
