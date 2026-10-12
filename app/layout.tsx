import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import 'katex/dist/katex.min.css'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'Noted', template: '%s · Noted' },
  description: 'Notizen für die Uni im Obsidian-Format – auch unterwegs.',
  applicationName: 'Noted',
  appleWebApp: { capable: true, title: 'Noted', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#1b1b20' },
  ],
}

// Setzt Theme und Schriftgröße vor dem ersten Zeichnen (kein Aufblitzen)
const prefsScript = `try{var t=localStorage.getItem('noted:theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);var f=localStorage.getItem('noted:fontSize');if(f)document.documentElement.style.setProperty('--editor-font-size',f+'px')}catch(e){}`

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get('x-nonce') ?? undefined
  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: prefsScript }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
