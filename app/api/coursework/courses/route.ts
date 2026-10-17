import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { courseSchema, createCourse } from '@/features/coursework/server/coursework'

export const POST = route('user', async ({ req, user }) => {
  const body = await parseJson(req, courseSchema, 16 * 1024)
  return json({ course: createCourse(user.id, body) }, { status: 201 })
})
