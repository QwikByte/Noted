import { route } from '@/features/auth/server/route'
import { sharedFileResponse } from '@/features/sharing/server/shares'

/** Datei einer geteilten Notiz – nur, was die Notiz selbst einbettet oder verlinkt */
export const GET = route<{ token: string; name: string[] }>('none', ({ req, params, ip }) =>
  sharedFileResponse(params.token, params.name.join('/'), ip, req.headers.get('range')),
)
