// Regeln für Notiz-, Ordner- und Dateinamen – gültig in Wikilinks und auf allen Dateisystemen.

/** Zeichen, die in Dateinamen oder Wikilinks Probleme machen */
const INVALID_NAME_CHARS = /[\\/:*?"<>|#^[\]]/
const INVALID_NAME_CHARS_GLOBAL = /[\\/:*?"<>|#^[\]]/g
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
const CONTROL_CHARS_GLOBAL = /[\u0000-\u001f\u007f]/g
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i

const NAME_MAX_LENGTH = 200

export function validateName(name: string): string | null {
  const n = name.trim()
  if (!n) return 'Der Name darf nicht leer sein.'
  if (n.length > NAME_MAX_LENGTH) return `Der Name ist zu lang (max. ${NAME_MAX_LENGTH} Zeichen).`
  if (INVALID_NAME_CHARS.test(n)) return 'Der Name darf diese Zeichen nicht enthalten: \\ / : * ? " < > | # ^ [ ]'
  if (CONTROL_CHARS.test(n)) return 'Der Name enthält ungültige Steuerzeichen.'
  if (n.startsWith('.')) return 'Der Name darf nicht mit einem Punkt beginnen.'
  if (n.endsWith('.')) return 'Der Name darf nicht mit einem Punkt enden.'
  if (RESERVED.test(n)) return 'Dieser Name ist reserviert.'
  return null
}

/** Macht aus beliebigem Text einen gültigen Namen. */
export function sanitizeName(name: string, fallback = 'Unbenannt'): string {
  let n = name
    .replace(CONTROL_CHARS_GLOBAL, '')
    .replace(INVALID_NAME_CHARS_GLOBAL, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .trim()
  if (n.length > NAME_MAX_LENGTH) n = n.slice(0, NAME_MAX_LENGTH).trim()
  if (!n || RESERVED.test(n)) n = fallback
  return n
}

/** Dateiname inkl. Endung bereinigen (für Anhänge). */
export function sanitizeFilename(filename: string): string {
  const match = /^(.*?)(\.[a-zA-Z0-9]{1,10})?$/.exec(filename.trim())
  const base = sanitizeName(match?.[1] ?? '', 'Datei')
  const ext = (match?.[2] ?? '').toLowerCase()
  return base.slice(0, NAME_MAX_LENGTH - ext.length) + ext
}

/** Hängt „ 1“, „ 2“ … an, bis der Name frei ist (Vergleich ohne Groß-/Kleinschreibung). */
export function uniqueName(base: string, taken: Iterable<string>, ext = ''): string {
  const set = new Set(Array.from(taken, (t) => t.toLowerCase()))
  if (!set.has((base + ext).toLowerCase())) return base + ext
  for (let i = 1; i < 10_000; i++) {
    const candidate = `${base} ${i}${ext}`
    if (!set.has(candidate.toLowerCase())) return candidate
  }
  return `${base} ${Date.now()}${ext}`
}

export function splitExtension(filename: string): { base: string; ext: string } {
  const m = /^(.*?)(\.[^.]{1,10})?$/.exec(filename)
  return { base: m?.[1] || filename, ext: m?.[2] ?? '' }
}
