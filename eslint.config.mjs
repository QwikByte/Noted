import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Nach Login/Logout wird bewusst komplett neu geladen, damit kein Client-Zustand übrig bleibt
      '@next/next/no-location-assign-relative-destination': 'off',
    },
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'data/**', 'next-env.d.ts', 'public/sw.js']),
])
