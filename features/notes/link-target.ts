// Neue Notiz aus einem Wikilink, dessen Ziel es noch nicht gibt
import { sanitizeName, validateName } from '@/shared/lib/names'

/**
 * Titel und Ordnerpfad aus dem Ziel eines Wikilinks: `[[Physik/Wellen.md]]` → „Wellen“ im Ordner „Physik“ – wie beim
 * Auflösen der Links zählt der letzte Teil. Ist der Titel so nicht erlaubt (`[[Was ist Entropie?]]`), stattdessen der
 * Grund und ein bereinigter Vorschlag.
 */
export function noteFromLinkTarget(target: string): { title: string; folderPath: string[] } | { error: string; suggestion: string } {
  const parts = target.split('/').map((p) => p.trim())
  const title = (parts.pop() ?? '').replace(/\.md$/i, '').trim()
  const error = validateName(title)
  if (error) return { error, suggestion: sanitizeName(title) }
  return { title, folderPath: parts.filter(Boolean) }
}
