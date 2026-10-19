// Typen für Dateien (API-Verträge zwischen Server und Browser)

export type Attachment = {
  id: string
  filename: string
  mime: string
  size: number
  createdAt: number
}

/** Datei samt den Notizen, die sie einbetten oder verlinken – danach richtet sich ihr Ordner im Bereich „Dateien“ */
export type FileEntry = Attachment & { noteIds: string[] }
