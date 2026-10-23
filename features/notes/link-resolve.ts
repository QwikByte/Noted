// Wikilinks auflösen, wenn Titel nur je Ordner eindeutig sind: [[Analysis/Übung 1]] meint die „Übung 1“ im Ordner
// Analysis (auch in „Uni/Analysis“), [[Übung 1]] ohne Ordner zuerst die im eigenen Ordner. Reine Logik für Browser und
// Server.
import { linkFolders } from '@/shared/markdown/meta'

/** Endet der Ordnerpfad (Namen von oben) mit dem Ordnerteil eines Links (klein geschrieben, siehe linkFolders)? */
function pathEndsWith(folders: string[], path: string[]): boolean {
  const offset = folders.length - path.length
  return offset >= 0 && path.every((name, i) => folders[offset + i].trim().toLowerCase() === name)
}

/**
 * Notizen, auf die ein Link zeigt – aus den Notizen mit seinem Titel. Mit Ordnerteil (`path`) die, deren Ordnerpfad
 * (`foldersOf`, Namen von oben) damit endet; passt keine (z. B. Ordner umbenannt), alle wie ohne Ordner. Liegt eine
 * davon im Ordner der verlinkenden Notiz (`fromFolderId`, null = oberste Ebene), nur diese. Bleiben mehrere, ist der
 * Link mehrdeutig.
 */
export function linkTargets<T extends { folderId: string | null }>(
  candidates: T[],
  path: string[],
  foldersOf: (c: T) => string[],
  fromFolderId?: string | null,
): T[] {
  const matching = path.length > 0 ? candidates.filter((c) => pathEndsWith(foldersOf(c), path)) : []
  const matches = matching.length > 0 ? matching : candidates
  const own = fromFolderId === undefined ? [] : matches.filter((c) => c.folderId === fromFolderId)
  return own.length > 0 ? own : matches
}

/** Ziel eines Links im Browser – bei mehreren wie linkTargets die zuletzt bearbeitete (`candidates` danach sortiert) */
export function resolveLinkTarget<T extends { folderId: string | null }>(
  target: string,
  candidates: T[],
  foldersOf: (c: T) => string[],
  fromFolderId?: string | null,
): T | null {
  return linkTargets(candidates, linkFolders(target), foldersOf, fromFolderId)[0] ?? null
}
