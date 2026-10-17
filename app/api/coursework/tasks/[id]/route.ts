import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { deleteTask, taskSchema, updateTask } from '@/features/coursework/server/coursework'

export const PUT = route<{ id: string }>('user', async ({ req, user, params }) => {
  const body = await parseJson(req, taskSchema, 256 * 1024)
  return json({ task: updateTask(user.id, params.id, body) })
})

export const DELETE = route<{ id: string }>('user', ({ user, params }) => {
  deleteTask(user.id, params.id)
  return json({ ok: true })
})
