// Datums- und Größenformatierung (deutsch)

const dateTime = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
const dateOnly = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' })
const time = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' })
const relative = new Intl.RelativeTimeFormat('de-DE', { numeric: 'auto' })

export function formatDateTime(ts: number | null | undefined): string {
  return ts ? dateTime.format(ts) : '–'
}

export function formatDate(ts: number): string {
  return dateOnly.format(ts)
}

/** „gerade eben“, „vor 5 Minuten“, „gestern“, sonst Datum */
export function formatRelative(ts: number, now = Date.now()): string {
  const diff = (ts - now) / 1000
  const abs = Math.abs(diff)
  if (abs < 45) return 'gerade eben'
  if (abs < 3600) return relative.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) {
    const d = new Date(ts)
    const today = new Date(now)
    if (d.getDate() === today.getDate()) return `heute, ${time.format(ts)}`
    return relative.format(Math.round(diff / 3600), 'hour')
  }
  if (abs < 7 * 86400) return relative.format(Math.round(diff / 86400), 'day')
  return dateOnly.format(ts)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
}

export function wordCount(text: string): number {
  const m = text.replace(/^---[\s\S]*?\n---/, '').match(/[\p{L}\p{N}]+/gu)
  return m ? m.length : 0
}

/** Kurze Beschreibung eines User-Agents, z. B. „Firefox auf Windows“ */
export function describeUserAgent(ua: string | null): string {
  if (!ua) return 'Unbekanntes Gerät'
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser'
  const os = /iPhone|iPad/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'unbekanntem System'
  return `${browser} auf ${os}`
}
