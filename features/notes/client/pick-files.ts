'use client'

/**
 * Dateidialog öffnen – synchron im Klick- bzw. Tastenereignis aufrufen, sonst blockiert ihn der Browser. Bei Abbruch
 * kommt eine leere Liste. `capture`: auf dem Handy direkt die Kamera (dann nur eine Datei).
 */
export function pickFiles(opts: { accept?: string; capture?: string } = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.hidden = true
    input.multiple = !opts.capture
    if (opts.accept) input.accept = opts.accept
    if (opts.capture) input.setAttribute('capture', opts.capture)
    const done = (files: File[]) => {
      input.remove()
      resolve(files)
    }
    input.addEventListener('change', () => done(Array.from(input.files ?? [])), { once: true })
    input.addEventListener('cancel', () => done([]), { once: true })
    document.body.append(input)
    input.click()
  })
}
