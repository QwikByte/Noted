// Tastatur im PDF-Viewer: welche Taste welche Aktion auslöst. Reine Logik ohne DOM – das Panel führt die Aktion aus.

export type PdfKeyAction =
  | 'find'
  | 'findNext'
  | 'findPrevious'
  | 'prevPage'
  | 'nextPage'
  | 'firstPage'
  | 'lastPage'
  | 'zoomIn'
  | 'zoomOut'
  | 'fitWidth'
  | 'highlight'
  | 'pageInput'
  | 'escape'

type Key = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>

/**
 * Aktion zu einem Tastendruck im PDF-Panel. `inField`: Fokus in einem Eingabefeld (Seite, Suche, Kommentar) – dort
 * gelten nur Strg/⌘+F und F3, alles andere gehört dem Feld. `scrollsSideways`: Die Seiten sind breiter als das Panel,
 * dann scrollen ← und → wie gewohnt seitwärts statt zu blättern.
 */
export function pdfKeyAction(e: Key, { inField = false, scrollsSideways = false } = {}): PdfKeyAction | null {
  if (e.altKey) return null
  const mod = e.ctrlKey || e.metaKey
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
  if (mod && !e.shiftKey && key === 'f') return 'find'
  if (!mod && key === 'F3') return e.shiftKey ? 'findPrevious' : 'findNext'
  if (inField) return null
  if (mod) return e.shiftKey && key === 'h' ? 'highlight' : null
  switch (key) {
    case 'ArrowLeft':
      return scrollsSideways ? null : 'prevPage'
    case 'ArrowRight':
      return scrollsSideways ? null : 'nextPage'
    case 'Home':
      return 'firstPage'
    case 'End':
      return 'lastPage'
    // Ohne Strg/⌘ – Strg/⌘ + Plus zoomt weiter die ganze Seite im Browser
    case '+':
      return 'zoomIn'
    case '-':
      return 'zoomOut'
    case '0':
      return 'fitWidth'
    case 'g':
      return 'pageInput'
    case 'Escape':
      return 'escape'
  }
  return null
}
