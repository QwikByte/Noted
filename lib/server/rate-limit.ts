import 'server-only'

type Bucket = { count: number; resetAt: number }

const globalForRl = globalThis as unknown as { __notedRateLimit?: Map<string, Bucket> }
const buckets = (globalForRl.__notedRateLimit ??= new Map())

/**
 * Einfacher In-Memory-Rate-Limiter mit festem Zeitfenster.
 * Ausreichend für eine einzelne Instanz (Docker-Container).
 */
export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const t = Date.now()
  if (buckets.size > 10_000) {
    for (const [k, b] of buckets) if (b.resetAt <= t) buckets.delete(k)
  }
  let bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= t) {
    bucket = { count: 0, resetAt: t + windowMs }
    buckets.set(key, bucket)
  }
  bucket.count++
  return { ok: bucket.count <= limit, retryAfterSec: Math.ceil((bucket.resetAt - t) / 1000) }
}

export function resetRateLimit(key: string) {
  buckets.delete(key)
}

export function clearAllRateLimits() {
  buckets.clear()
}
