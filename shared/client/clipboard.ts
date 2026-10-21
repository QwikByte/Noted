'use client'

/** Text in die Zwischenablage kopieren (mit Fallback für unsichere Kontexte, z. B. http im LAN). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* Fallback */
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  // Bei offenem Dialog ist alles außerhalb unbedienbar – dort ließe sich das Feld nicht markieren
  const host = [...document.querySelectorAll('dialog:modal')].at(-1) ?? document.body
  host.appendChild(ta)
  ta.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  ta.remove()
  return ok
}

/** Formatierten Text kopieren (z. B. zum Einfügen in Word) – ohne Unterstützung im Browser nur den Text. */
export async function copyHtml(html: string, text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined' && window.isSecureContext) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ])
      return true
    }
  } catch {
    /* Fallback */
  }
  return copyText(text)
}

/**
 * Text aus der Zwischenablage lesen (für „Einfügen“ im Kontextmenü). null, wenn der Browser es nicht erlaubt – z. B.
 * über http im LAN oder ohne Zustimmung; dann bleibt Strg+V.
 */
export async function readText(): Promise<string | null> {
  try {
    if (navigator.clipboard?.readText && window.isSecureContext) return await navigator.clipboard.readText()
  } catch {
    /* nicht erlaubt */
  }
  return null
}
