// pdf.js liefert für den Worker keine Typen mit. Auf dem Server wird er nur vorab geladen (siehe extract.ts).
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown
}
