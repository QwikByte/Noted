import { json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { getGraph } from '@/features/graph/server/graph'

export const GET = route('user', ({ user }) => json(getGraph(user.id)))
