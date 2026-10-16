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
  // Aufbau nach Features (siehe AGENTS.md): shared/ kennt keine Features, Features kennen die Routen in app/ nicht
  {
    files: ['shared/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@/features/**', '@/app/**'], message: 'shared/ darf nicht aus features/ oder app/ importieren.' }] },
      ],
    },
  },
  {
    files: ['features/**'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@/app/**'], message: 'Features dürfen nicht aus app/ importieren – Logik gehört ins Feature.' }] },
      ],
    },
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'data/**', 'next-env.d.ts', 'public/sw.js', 'public/pdfjs/**', 'sw/**']),
])
