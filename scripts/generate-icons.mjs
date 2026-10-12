// Erzeugt die PNG-Icons der PWA aus den SVG-Vorlagen (benötigt Playwright/Chromium).
// Aufruf: node scripts/generate-icons.mjs
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const icon = fs.readFileSync(path.join(root, 'public/icons/icon.svg'), 'utf8')
const maskable = fs.readFileSync(path.join(root, 'public/icons/maskable.svg'), 'utf8')

const targets = [
  { svg: icon, size: 192, out: 'public/icons/icon-192.png' },
  { svg: icon, size: 512, out: 'public/icons/icon-512.png' },
  { svg: maskable, size: 512, out: 'public/icons/maskable-512.png' },
  { svg: maskable, size: 180, out: 'app/apple-icon.png' },
]

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage()
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size })
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${t.svg.replace('<svg ', `<svg width="${t.size}" height="${t.size}" `)}</body></html>`,
  )
  await page.screenshot({ path: path.join(root, t.out), omitBackground: true })
  console.log('✓', t.out)
}
await browser.close()
