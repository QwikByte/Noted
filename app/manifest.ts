import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Noted – Notizen für die Uni',
    short_name: 'Noted',
    description: 'Notizen im Obsidian-Format – auch unterwegs.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#ffffff',
    theme_color: '#2b44c2',
    lang: 'de',
    categories: ['education', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
    shortcuts: [
      { name: 'Neue Notiz', url: '/?new=1', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Neue Vorlesungsnotiz', url: '/?new=lecture', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  }
}
