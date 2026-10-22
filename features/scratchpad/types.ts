// Schmierzettel: Typen der API zwischen Server und Browser

/** Der Schmierzettel eines Kontos – `version: 0` und `updatedAt: null` heißen „noch nie gespeichert“ */
export type Scratchpad = {
  content: string
  /** Zählt jede Änderung auf dem Server hoch – Grundlage der Konfliktprüfung zwischen Geräten */
  version: number
  /** Zeit der letzten Änderung, gesetzt vom Server (auf allen Geräten gleich) */
  updatedAt: number | null
}
