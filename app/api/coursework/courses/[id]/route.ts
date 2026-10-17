import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { courseSchema, deleteCourse, updateCourse } from '@/features/coursework/server/coursework'

export const PUT = route<{ id: string }>('user', async ({ req, user, params }) => {
  const body = await parseJson(req, courseSchema, 16 * 1024)
  return json({ course: updateCourse(user.id, params.id, body) })
})

/** Fach mit allen Blättern und Abgabeterminen löschen */
export const DELETE = route<{ id: string }>('user', ({ user, params }) => {
  deleteCourse(user.id, params.id)
  return json({ ok: true })
})
