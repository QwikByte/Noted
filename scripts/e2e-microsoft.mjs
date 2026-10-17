// Attrappe für Microsoft (Anmeldung und Graph) in den E2E-Tests: meldet sofort an und liefert Beispieltermine.
// Die Termine liegen relativ zum abgefragten Zeitraum (Beginn = heute 0:00 Uhr im Browser), damit „Heute“ immer passt.
import crypto from 'node:crypto'
import http from 'node:http'

const HOUR = 3_600_000

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

const idToken = () =>
  `x.${Buffer.from(JSON.stringify({ name: 'Mia Muster', preferred_username: 'mia@uni.example' })).toString('base64url')}.sig`

/** Graph-Zeitangabe (UTC ohne Zone) für start + Stunden */
const at = (start, hours) => ({ dateTime: new Date(start + hours * HOUR).toISOString().replace('Z', '0000'), timeZone: 'UTC' })
/** Ganztägig: Datum des Tages (Mittag, damit die Zeitzone des Browsers keine Rolle spielt) */
const day = (start, days) => ({ dateTime: `${new Date(start + days * 24 * HOUR + 12 * HOUR).toISOString().slice(0, 10)}T00:00:00.0000000`, timeZone: 'UTC' })

function events(calendarId, start) {
  if (calendarId === 'cal-uni') {
    return [{ id: 'u1', subject: 'Übung Analysis', start: at(start, 24 + 14), end: at(start, 24 + 15.5), location: { displayName: 'Raum 2.14' } }]
  }
  return [
    {
      id: 'e1',
      subject: 'Analysis I',
      start: at(start, 10.25),
      end: at(start, 11.75),
      location: { displayName: 'Hörsaal 1' },
      onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/e2e' },
    },
    { id: 'e2', subject: 'Abgesagt', start: at(start, 13), end: at(start, 14), isCancelled: true },
    { id: 'e3', subject: 'Exkursion', start: day(start, 2), end: day(start, 3), isAllDay: true },
  ]
}

/** Startet die Attrappe; liefert die Adresse */
export function startMicrosoftMock(port) {
  const codes = new Map()
  let access = ''
  let refresh = ''
  const issue = (res) => {
    access = `access-${crypto.randomUUID()}`
    refresh = `refresh-${crypto.randomUUID()}`
    json(res, 200, { access_token: access, refresh_token: refresh, expires_in: 3600, id_token: idToken() })
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`)
    if (req.method === 'GET' && url.pathname === '/common/oauth2/v2.0/authorize') {
      // Gleich „angemeldet und zugestimmt“ zurück an Noted
      const code = crypto.randomUUID()
      codes.set(code, url.searchParams.get('code_challenge'))
      const back = new URL(url.searchParams.get('redirect_uri'))
      back.searchParams.set('code', code)
      back.searchParams.set('state', url.searchParams.get('state'))
      res.writeHead(302, { location: back.toString() })
      return res.end()
    }
    if (req.method === 'POST' && url.pathname === '/common/oauth2/v2.0/token') {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        const body = new URLSearchParams(raw)
        if (body.get('client_secret') !== 'e2e-secret') return json(res, 401, { error: 'invalid_client' })
        if (body.get('grant_type') === 'authorization_code') {
          const challenge = codes.get(body.get('code'))
          codes.delete(body.get('code'))
          const verified = crypto.createHash('sha256').update(body.get('code_verifier') ?? '').digest('base64url')
          if (!challenge || challenge !== verified) return json(res, 400, { error: 'invalid_grant' })
          return issue(res)
        }
        if (body.get('refresh_token') !== refresh) return json(res, 400, { error: 'invalid_grant' })
        issue(res)
      })
      return
    }
    if (req.method === 'GET' && url.pathname.startsWith('/v1.0/')) {
      if (req.headers.authorization !== `Bearer ${access}`) return json(res, 401, { error: { code: 'InvalidAuthenticationToken' } })
      if (url.pathname === '/v1.0/me/calendars') {
        return json(res, 200, {
          value: [
            { id: 'cal-main', name: 'Kalender', hexColor: '#1c7ed6', isDefaultCalendar: true },
            { id: 'cal-uni', name: 'Stundenplan', hexColor: '#2f9e44', isDefaultCalendar: false },
          ],
        })
      }
      const m = /^\/v1\.0\/me\/calendars\/([^/]+)\/calendarView$/.exec(url.pathname)
      if (m) return json(res, 200, { value: events(decodeURIComponent(m[1]), Date.parse(url.searchParams.get('startDateTime'))) })
    }
    json(res, 404, { error: 'not_found' })
  })
  server.listen(port, '127.0.0.1')
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() }
}
