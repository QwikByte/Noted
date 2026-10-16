/**
 * Ziel nach dem Login: nur Pfade innerhalb der App (kein Open Redirect).
 * Steuerzeichen und Backslashes werden abgelehnt, weil Browser sie beim Parsen
 * entfernen bzw. als „/“ deuten (z. B. „/\t/evil.com“ → „//evil.com“).
 */
export function safeRedirectPath(value: string | string[] | undefined | null): string {
  const v = Array.isArray(value) ? value[0] : value
  if (!v || !v.startsWith('/') || /[\u0000-\u001f\u007f\\]/.test(v)) return '/'
  try {
    const base = 'http://noted.invalid'
    const url = new URL(v, base)
    if (url.origin !== base) return '/'
    return url.pathname + url.search + url.hash
  } catch {
    return '/'
  }
}
