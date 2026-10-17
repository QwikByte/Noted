import 'server-only'
import path from 'node:path'

function bool(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '' || value === 'auto') return undefined
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** Konfiguration aus Umgebungsvariablen. Wird bei jedem Aufruf neu gelesen (praktisch für Tests). */
export function getConfig() {
  // turbopackIgnore: Datenverzeichnis ist Laufzeit-Konfiguration, nicht Teil des Builds
  const dataDir = path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || path.join(process.cwd(), 'data'))
  return {
    dataDir,
    dbPath: path.join(dataDir, 'noted.db'),
    attachmentsDir: path.join(dataDir, 'attachments'),
    keyFile: path.join(dataDir, 'secret.key'),
    appName: process.env.APP_NAME || 'Noted',
    /** Sitzungsdauer (gleitend) in Tagen */
    sessionDays: num(process.env.SESSION_DAYS, 30),
    maxUploadBytes: num(process.env.MAX_UPLOAD_MB, 25) * 1024 * 1024,
    maxImportBytes: num(process.env.MAX_IMPORT_MB, 200) * 1024 * 1024,
    /** undefined = automatisch anhand des Protokolls (x-forwarded-proto) */
    cookieSecure: bool(process.env.COOKIE_SECURE),
    /** Öffentliche URL, z. B. https://notes.example.com (für Origin-Prüfung) */
    appUrl: process.env.APP_URL?.replace(/\/+$/, '') || undefined,
    trashDays: num(process.env.TRASH_DAYS, 30),
    /** Microsoft-Kalender: App-Registrierung in Microsoft Entra – ohne Client-ID und Secret ist die Funktion aus */
    microsoft: {
      clientId: process.env.MICROSOFT_CLIENT_ID || undefined,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET || undefined,
      /** common = private und Schul-/Arbeitskonten; sonst z. B. organizations oder die ID des eigenen Mandanten */
      tenant: process.env.MICROSOFT_TENANT || 'common',
      /** Andere Adressen nur für nationale Clouds (z. B. US Government) und Tests */
      loginUrl: (process.env.MICROSOFT_LOGIN_URL || 'https://login.microsoftonline.com').replace(/\/+$/, ''),
      graphUrl: (process.env.MICROSOFT_GRAPH_URL || 'https://graph.microsoft.com').replace(/\/+$/, ''),
    },
    /** Status der automatischen Updates (schreibt scripts/auto-update.sh, im Container nur lesend eingebunden) */
    updateDir: path.resolve(/*turbopackIgnore: true*/ process.env.UPDATE_STATUS_DIR || path.join(process.cwd(), '.update')),
    /** Hier legt der Admin-Bereich Update-Anfragen ab; der Update-Dienst auf dem Server holt sie ab */
    updateRequestDir: path.resolve(
      /*turbopackIgnore: true*/ process.env.UPDATE_REQUEST_DIR ||
        path.join(process.env.UPDATE_STATUS_DIR || path.join(process.cwd(), '.update'), 'requests'),
    ),
  }
}
