'use client'
import DOMPurify from 'dompurify'

let hooked = false

/** Gerendertes Markdown bereinigen: keine Skripte/Formulare, externe Links in neuem Tab. */
export function sanitize(html: string) {
  if (!hooked) {
    hooked = true
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A') {
        const href = node.getAttribute('href') ?? ''
        if (/^(https?:|mailto:)/i.test(href)) {
          node.setAttribute('target', '_blank')
          node.setAttribute('rel', 'noopener noreferrer')
        }
      }
    })
  }
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'form'] })
}
