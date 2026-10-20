// Adressen in geteilten Notizen: Dateien laufen über den Link, nicht über /api/files (dafür bräuchte es ein Konto).
// Reine Logik ohne Browser- oder Server-Abhängigkeit.

/** Datei einer geteilten Notiz */
export function shareFileUrl(token: string, name: string): string {
  return `/api/s/${encodeURIComponent(token)}/files/` + name.split('/').map(encodeURIComponent).join('/')
}

/**
 * Adressen /api/files/… auf die Dateien der Freigabe umschreiben: in HTML (formatierter Text, eingebettetes HTML in
 * Markdown) und in Markdown-Links wie [S. 3](/api/files/Skript.pdf#page=3) aus dem PDF-Viewer
 */
export function rewriteFileUrls(text: string, token: string): string {
  const base = `/api/s/${encodeURIComponent(token)}/files/`
  return text.replace(/(\s(?:src|href)=["']|\]\()\/api\/files\//gi, `$1${base}`)
}
