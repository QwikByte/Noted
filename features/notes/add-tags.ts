// Tags zu einer Notiz hinzufügen (z. B. von der KI vorgeschlagene): bei Markdown und Mindmaps in die Properties – so
// wie Obsidian sie liest –, bei formatiertem und einfachem Text als #tags in einer eigenen Zeile am Ende.
import { isSeq, parseDocument } from 'yaml'
import { escapeHtml } from '@/shared/lib/html'
import { splitFrontmatter } from '@/shared/markdown/meta'
import type { NoteFormat } from './types'

const TAG_KEYS = ['tags', 'tag', 'Tags']

const inlineTags = (tags: string[]) => tags.map((t) => `#${t}`).join(' ')

/** Notiz mit zusätzlichen Tags – Canvas hat keinen Platz für Tags und bleibt, wie es ist */
export function withTags(format: NoteFormat, content: string, tags: string[]): string {
  if (!tags.length || format === 'canvas') return content
  if (format === 'richtext') return `${content}<p>${escapeHtml(inlineTags(tags))}</p>`
  const appended = `${content.replace(/\s+$/, '')}${content.trim() ? '\n\n' : ''}${inlineTags(tags)}\n`
  if (format === 'text') return appended
  const fm = splitFrontmatter(content)
  if (!fm) return `---\ntags:\n${tags.map((t) => `  - ${t}`).join('\n')}\n---\n${content}`
  const doc = parseDocument(fm.raw)
  // Properties, die sich nicht sauber lesen lassen, bleiben unangetastet – die Tags kommen dann in den Text
  if (doc.errors.length) return appended
  const key = TAG_KEYS.find((k) => doc.has(k)) ?? 'tags'
  const current = doc.get(key)
  if (isSeq(current)) for (const t of tags) current.add(t)
  else {
    const before = typeof current === 'string' ? current.split(/[,\s]+/).filter(Boolean) : []
    doc.set(key, [...before, ...tags])
  }
  return `---\n${doc.toString().replace(/\n$/, '')}\n---\n${fm.body}`
}
