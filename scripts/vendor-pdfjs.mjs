#!/usr/bin/env node
// Kopiert die Laufzeitdateien von pdf.js (Worker, Zeichensatz-Tabellen, Standardschriften, WebAssembly-Decoder)
// nach public/pdfjs/ – der eingebaute PDF-Viewer lädt sie von dort. Läuft vor `npm run build` und `npm run dev`,
// damit die Dateien immer zur installierten pdf.js-Version passen.
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const src = path.join(root, 'node_modules/pdfjs-dist')
const dest = path.join(root, 'public/pdfjs')

const { version } = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'))
fs.rmSync(dest, { recursive: true, force: true })
fs.mkdirSync(dest, { recursive: true })
// „legacy“-Build wie im Viewer (components/app/pdf/PdfPanel.tsx) – läuft auch in älteren Browsern
fs.copyFileSync(path.join(src, 'legacy/build/pdf.worker.min.mjs'), path.join(dest, 'pdf.worker.min.mjs'))
for (const dir of ['cmaps', 'standard_fonts', 'iccs', 'wasm']) {
  // QuickJS dient nur für JavaScript in PDF-Formularen – das ist im Viewer abgeschaltet
  fs.cpSync(path.join(src, dir), path.join(dest, dir), { recursive: true, filter: (p) => !path.basename(p).startsWith('quickjs') })
}
fs.writeFileSync(path.join(dest, 'VERSION'), `${version}\n`)
console.log(`pdf.js ${version} → public/pdfjs`)
