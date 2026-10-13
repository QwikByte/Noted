// Versionsinfos dieses Builds – setzt next.config.ts beim Build fest ein (Quelle: scripts/build-info.mjs).
export const BUILD = {
  version: process.env.NOTED_VERSION || 'dev',
  commit: process.env.NOTED_COMMIT || '',
  buildDate: process.env.NOTED_BUILD_DATE || '',
  buildId: process.env.NOTED_BUILD_ID || 'dev',
}
