import 'server-only'
// ZIP-Archive erzeugen – als Stream (Downloads, die Datei für Datei gelesen werden) oder auf einmal (Archiv im Archiv)
import { Zip, ZipDeflate, ZipPassThrough, zipSync, type Zippable } from 'fflate'

/** Eintrag im Archiv – `data` wird erst beim Schreiben gelesen; `compress: false` für schon gepackte Dateien */
export type ZipEntry = { path: string; mtime?: number; compress: boolean; data: () => Uint8Array }

/** Archiv als Stream: Jede Datei wird erst gelesen, wenn der Empfänger die nächste anfordert. */
export function zipStream(entries: ZipEntry[]): ReadableStream<Uint8Array> {
  let index = 0
  let zip: Zip
  return new ReadableStream<Uint8Array>({
    start(controller) {
      zip = new Zip((err, chunk, final) => {
        if (err) return controller.error(err)
        controller.enqueue(chunk)
        if (final) controller.close()
      })
    },
    pull() {
      if (index < entries.length) {
        const e = entries[index++]
        const file = e.compress ? new ZipDeflate(e.path, { level: 6 }) : new ZipPassThrough(e.path)
        if (e.mtime !== undefined) file.mtime = e.mtime
        zip.add(file)
        file.push(e.data(), true)
      } else if (index === entries.length) {
        index++
        zip.end()
      }
    },
  })
}

/** Archiv auf einmal im Speicher */
export function zipBytes(entries: ZipEntry[]): Uint8Array {
  const files: Zippable = {}
  for (const e of entries) {
    files[e.path] = [e.data(), { level: e.compress ? 6 : 0, ...(e.mtime !== undefined ? { mtime: e.mtime } : {}) }]
  }
  return zipSync(files)
}
