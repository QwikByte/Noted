// Dateien in der Ordnerstruktur der Notizen: Eine Datei steht im Ordner jeder Notiz, die sie einbettet oder verlinkt
import { sortByName } from '@/features/notes/tree'
import type { Folder, NoteSummary } from '@/features/notes/types'
import type { FileEntry } from './types'

/** Ebene im Bereich „Dateien“ für Dateien, die in keiner Notiz vorkommen (statt einer Ordner-ID) */
export const UNLINKED = 'unlinked'

/** Datei auf einer Ebene – mit den Notizen dieser Ebene, die sie einbetten */
export type FileItem = { file: FileEntry; notes: NoteSummary[] }

/**
 * Inhalt einer Ebene: Unterordner, unter denen Dateien liegen (mit Anzahl), und die Dateien der Notizen direkt in
 * diesem Ordner. `level`: Ordner-ID, `null` für die oberste Ebene oder `UNLINKED`.
 */
export function filesAt(files: FileEntry[], notes: NoteSummary[], folders: Folder[], level: string | null) {
  const folderById = new Map(folders.map((f) => [f.id, f]))
  const noteById = new Map(notes.map((n) => [n.id, n]))
  // Wie in der Seitenleiste: Notizen in unbekannten Ordnern stehen auf der obersten Ebene
  const home = (n: NoteSummary) => (n.folderId && folderById.has(n.folderId) ? n.folderId : null)
  const inFolder = new Map<string, Set<string>>()
  const here: FileItem[] = []
  const unlinked: FileItem[] = []

  for (const file of files) {
    const fileNotes = file.noteIds.flatMap((id) => noteById.get(id) ?? [])
    if (fileNotes.length === 0) {
      unlinked.push({ file, notes: [] })
      continue
    }
    const local = fileNotes.filter((n) => home(n) === level)
    if (local.length > 0) here.push({ file, notes: sortByName(local) })
    // In allen Ordnern darüber mitzählen
    for (const n of fileNotes) {
      const seen = new Set<string>()
      for (let id = home(n); id && !seen.has(id); id = folderById.get(id)?.parentId ?? null) {
        seen.add(id)
        let set = inFolder.get(id)
        if (!set) inFolder.set(id, (set = new Set()))
        set.add(file.id)
      }
    }
  }

  if (level === UNLINKED) return { folders: [], files: unlinked, unlinked: unlinked.length }
  const isChild = (f: Folder) => (level === null ? !f.parentId || !folderById.has(f.parentId) : f.parentId === level)
  return {
    folders: sortByName(folders.filter((f) => isChild(f) && inFolder.has(f.id))).map((folder) => ({
      folder,
      count: inFolder.get(folder.id)!.size,
    })),
    files: here,
    unlinked: unlinked.length,
  }
}
