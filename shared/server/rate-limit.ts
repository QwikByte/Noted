import 'server-only'

type Bucket = { count: number; resetAt: number }

const MAX_BUCKETS = 50_000
const PRUNE_INTERVAL_MS = 10_000

const globalForRl = globalThis as unknown as { __notedRateLimit?: Map<string, Bucket>; __notedRlPruned?: number }
const buckets = (globalForRl.__notedRateLimit ??= new Map())

function prune(t: number) {
  if (t - (globalForRl.__notedRlPruned ?? 0) < PRUNE_INTERVAL_MS && buckets.size < MAX_BUCKETS) return
  globalForRl.__notedRlPruned = t
  for (const [k, b] of buckets) if (b.resetAt <= t) buckets.delete(k)
  // Immer noch zu viele (Angriff mit zufälligen Schlüsseln): älteste verwerfen
  if (buckets.size >= MAX_BUCKETS) {
    let excess = buckets.size - Math.floor(MAX_BUCKETS * 0.9)
    for (const k of buckets.keys()) {
      if (excess-- <= 0) break
      buckets.delete(k)
    }
  }
}

/**
 * Einfacher In-Memory-Rate-Limiter mit festem Zeitfenster.
 * Ausreichend für eine einzelne Instanz (Docker-Container).
 */
export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const t = Date.now()
  prune(t)
  let bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= t) {
    bucket = { count: 0, resetAt: t + windowMs }
    buckets.set(key, bucket)
  }
  bucket.count++
  return { ok: bucket.count <= limit, retryAfterSec: Math.ceil((bucket.resetAt - t) / 1000) }
}

/** Prüft, ohne einen Versuch zu zählen. */
export function isRateLimited(key: string, limit: number): boolean {
  const bucket = buckets.get(key)
  return !!bucket && bucket.resetAt > Date.now() && bucket.count >= limit
}

export function resetRateLimit(key: string) {
  buckets.delete(key)
}

export function resetRateLimitPrefix(prefix: string) {
  for (const k of buckets.keys()) if (k.startsWith(prefix)) buckets.delete(k)
}

export function clearAllRateLimits() {
  buckets.clear()
}

/** Schlüssel für IP-basierte Limits: IPv6 wird auf das /64-Netz reduziert (sonst beliebig viele Adressen). */
export function ipKey(ip: string | null): string {
  if (!ip) return 'unknown'
  if (!ip.includes(':')) return ip
  const [head, tail = ''] = ip.toLowerCase().split('::')
  const h = head ? head.split(':') : []
  const t = tail ? tail.split(':') : []
  const groups = ip.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '') || '0').join(':') + '::/64'
}
