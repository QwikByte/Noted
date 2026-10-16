import { getDb } from '@/shared/server/db'

export function GET() {
  try {
    getDb().prepare('SELECT 1').get()
    return Response.json({ ok: true })
  } catch {
    return Response.json({ ok: false }, { status: 503 })
  }
}
