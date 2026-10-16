// Typen für Anhänge (API-Verträge zwischen Server und Browser)

export type Attachment = {
  id: string
  filename: string
  mime: string
  size: number
  createdAt: number
}
