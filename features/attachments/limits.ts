// Grenzen der Volltextsuche in Anhängen – darüber hinaus wird eine Datei gekürzt oder gar nicht durchsucht

/** Seiten eines PDFs, die höchstens durchsucht werden */
export const INDEX_MAX_PAGES = 400
/** Zeichen Text je Datei (ca. 2 MB) – der Rest wird abgeschnitten */
export const INDEX_MAX_CHARS = 2_000_000
/** Zeit für das Auslesen einer Datei */
export const INDEX_TIMEOUT_MS = 20_000
