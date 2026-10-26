// Typen für Dateien (API-Verträge zwischen Server und Browser)

export type Attachment = {
  id: string
  filename: string
  mime: string
  size: number
  createdAt: number
}

/**
 * Volltextsuche in einer Datei: done – durchsuchbar (reason: Hinweis, falls gekürzt) · skipped – nicht durchsucht
 * (reason: Grund, z. B. kein Text oder zu groß) · failed – Fehler beim Lesen · pending – wird noch gelesen
 */
export type SearchIndexInfo = { state: 'done' | 'skipped' | 'failed' | 'pending'; pages: number; reason: string | null }

/**
 * Datei samt den Notizen, die sie einbetten oder verlinken – danach richtet sich ihr Ordner im Bereich „Dateien“.
 * search fehlt bei Dateien, deren Text nicht durchsucht wird (z. B. Bilder).
 */
export type FileEntry = Attachment & { noteIds: string[]; search?: SearchIndexInfo }

/** Treffer der Volltextsuche in einer Datei – page: Seite im PDF (Textdateien: 1) */
export type FileSearchResult = { id: string; filename: string; mime: string; page: number; snippet: string }

/**
 * Notiz, die auf eine Datei verweist (Rückverweis im PDF-Viewer) – `pages`: zitierte Seiten (aufsteigend), `whole`:
 * auch ohne Seite eingebettet oder verlinkt
 */
export type FileReference = { id: string; title: string; folderId: string | null; pages: number[]; whole: boolean }
