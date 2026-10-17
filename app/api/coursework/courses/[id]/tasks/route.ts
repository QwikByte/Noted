import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { createTask, taskSchema } from '@/features/coursework/server/coursework'

export const POST = route<{ id: string }>('user', async ({ req, user, params }) => {
  const body = await parseJson(req, taskSchema, 256 * 1024)
  return json({ task: createTask(user.id, params.id, body) }, { status: 201 })
})
