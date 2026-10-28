'use client'
// KI-Chat im Fenster der Werkzeugleiste: Fragen an Claude zu Notizen, Dateien, Karteikarten, Lernstand und Kalender –
// oder ganz allgemein. Claude liest selbst nach, was es braucht; Vorschläge (Notiz, Karten, Termin) legt erst ein Klick
// an. Der Chat wird nicht gespeichert (siehe client/chat.ts).
import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  AlertCircle,
  Check,
  ClipboardCopy,
  FilePlus,
  FileText,
  Globe,
  ImagePlus,
  Layers,
  Loader2,
  MessageSquarePlus,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  X,
} from 'lucide-react'
import { useApp } from '@/features/workspace/client/context'
import { useNav } from '@/features/workspace/client/nav'
import { useNotes } from '@/features/notes/client/queries'
import { parseViews } from '@/features/pdf/positions'
import { Button } from '@/shared/ui/button'
import { ErrorText, useToast } from '@/shared/ui/toast'
import { cn } from '@/shared/ui/cn'
import { usePref } from '@/shared/client/prefs'
import { copyText } from '@/shared/client/clipboard'
import { errorMessage } from '@/shared/client/api'
import { sanitizeName } from '@/shared/lib/names'
import { chatStore, useChat, type ChatPart, type ChatTurn } from '../client/chat'
import { useAiSettings } from '../client/ai'
import { photoForAi } from '../client/photo'
import { MAX_AI_CHAT_IMAGES, MAX_AI_CHAT_TEXT } from '../limits'
import { modelLabel } from '../models'
import type { AiImage, ChatRef } from '../types'
import { AiSetupHint } from './AiSetupHint'

// Die Werkzeugleiste lädt den Chat auf jeder Seite mit – Markdown (samt KaTeX und Syntaxfarben), Vorschläge und der
// Kartendialog kommen erst, wenn sie gebraucht werden
const CardMarkdown = dynamic(() => import('@/features/flashcards/components/CardMarkdown').then((m) => m.CardMarkdown), {
  ssr: false,
})
const ChatProposal = dynamic(() => import('./ChatProposal').then((m) => m.ChatProposal), { ssr: false })
const AiCardsDialog = dynamic(() => import('./AiCardsDialog').then((m) => m.AiCardsDialog), { ssr: false })

const refKey = (r: ChatRef) => (r.kind === 'note' ? `note:${r.id}` : `pdf:${r.file}`)
const refLabel = (r: ChatRef) => (r.kind === 'note' ? `Notiz „${r.title}“` : `PDF „${r.file}“${r.page ? `, S. ${r.page}` : ''}`)

/** Aktuelle Seite eines offenen PDFs – gemerkt vom Viewer */
function pdfPage(file: string): number | null {
  try {
    return parseViews(localStorage.getItem('noted:pdfpos'))[file]?.page ?? null
  } catch {
    return null
  }
}

/** Was gerade offen ist: die Notiz der Ansicht (nicht aus dem Tresor) und das PDF daneben */
function useOpenRefs(): ChatRef[] {
  const { view } = useNav()
  const { notes } = useNotes()
  const [pdfPref] = usePref<string>('noted:pdf', '')
  return useMemo(() => {
    const refs: ChatRef[] = []
    if (view.kind === 'note') {
      const note = notes.find((n) => n.id === view.id)
      if (note && !note.vault) refs.push({ kind: 'note', id: note.id, title: note.title })
    }
    try {
      const file = (JSON.parse(pdfPref) as { file?: unknown } | null)?.file
      if (typeof file === 'string' && file) refs.push({ kind: 'pdf', file, page: null })
    } catch {
      /* kein PDF offen */
    }
    return refs
  }, [view, notes, pdfPref])
}

const SUGGESTIONS = ['Was sollte ich heute lernen?', 'Welche Termine habe ich diese Woche?']
const NOTE_SUGGESTIONS = ['Fasse die geöffnete Notiz zusammen', 'Erstelle Karteikarten zur geöffneten Notiz']

/** Knopf im Fensterkopf: neuen Chat beginnen (der bisherige ist dann weg) */
export function AiChatActions() {
  const { turns } = useChat()
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      data-no-drag
      onClick={() => chatStore.reset()}
      disabled={turns.length === 0}
      aria-label="Neuer Chat"
      title="Neuer Chat – der bisherige wird nicht gespeichert"
    >
      <MessageSquarePlus className="size-4" />
    </Button>
  )
}

export function AiChat() {
  const { data: settings } = useAiSettings()
  const { turns } = useChat()
  const [web, setWeb] = usePref<'1' | '0'>('noted:aiChat:web', '1')
  const [text, setText] = useState('')
  const [images, setImages] = useState<AiImage[]>([])
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set())
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const openRefs = useOpenRefs()
  const refs = openRefs.filter((r) => !excluded.has(refKey(r)))
  const running = turns.some((t) => t.status === 'running')
  const fileInput = useRef<HTMLInputElement>(null)
  const scroller = useRef<HTMLDivElement>(null)

  // Mitscrollen, solange man unten ist – wer nach oben gescrollt hat, liest in Ruhe weiter
  const stick = useRef(true)
  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [turns])

  const sendOpts = { web: web === '1', onWebUnavailable: () => setWeb('0') }

  function send(question = text) {
    if (running || (!question.trim() && !images.length)) return
    // Die Seite eines PDFs erst jetzt – der Viewer merkt sie sich beim Blättern
    const withPages = refs.map((r) => (r.kind === 'pdf' ? { ...r, page: pdfPage(r.file) } : r))
    void chatStore.send({ text: question.trim(), images, refs: withPages }, sendOpts)
    setText('')
    setImages([])
    setError(null)
    stick.current = true
  }

  async function addImages(files: File[]) {
    const room = MAX_AI_CHAT_IMAGES - images.length
    if (!files.length) return
    if (room <= 0) {
      setError(`Höchstens ${MAX_AI_CHAT_IMAGES} Bilder je Frage.`)
      return
    }
    setAdding(true)
    setError(null)
    try {
      const added: AiImage[] = []
      for (const f of files.slice(0, room)) added.push(await photoForAi(f))
      setImages((list) => [...list, ...added].slice(0, MAX_AI_CHAT_IMAGES))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setAdding(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  if (!settings) return <div className="h-40" />
  if (!settings.configured) {
    return (
      <div className="p-3">
        <AiSetupHint what="Mit Claude chatten" />
      </div>
    )
  }

  const suggestions = [...(openRefs.some((r) => r.kind === 'note') ? NOTE_SUGGESTIONS : []), ...SUGGESTIONS]
  return (
    <div
      className="flex h-[min(36rem,calc(100dvh-7rem))] min-h-0 flex-col group-data-[maximized]/window:h-auto group-data-[maximized]/window:flex-1"
      data-testid="ai-chat"
    >
      <div
        ref={scroller}
        className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-3"
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
        }}
        aria-live="polite"
      >
        {turns.length === 0 ? (
          <div className="mx-auto max-w-md space-y-3 py-4 text-center">
            <Sparkles className="mx-auto size-6 text-accent-text" />
            <p className="text-sm text-muted">
              Frag Claude – zu deinen Notizen, Dateien, Karteikarten, deinem Lernstand und Kalender oder ganz allgemein. Claude
              schlägt auch Notizen, Karten und Termine vor.
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {suggestions.map((s) => (
                <Button key={s} size="sm" variant="subtle" onClick={() => send(s)}>
                  {s}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          turns.map((turn) => <Turn key={turn.id} turn={turn} retry={() => chatStore.retry(turn.id, sendOpts)} />)
        )}
      </div>

      <form
        className="space-y-2 border-t border-border p-2"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        {refs.length || images.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {refs.map((r) => (
              <span key={refKey(r)} className="inline-flex max-w-full items-center gap-1 rounded-full bg-subtle py-0.5 pr-1 pl-2 text-xs text-muted">
                <FileText className="size-3 shrink-0" />
                <span className="truncate" title="Claude weiß, dass das gerade offen ist, und liest es bei Bedarf">
                  {refLabel(r)}
                </span>
                <button
                  type="button"
                  onClick={() => setExcluded((s) => new Set(s).add(refKey(r)))}
                  className="rounded-full p-0.5 hover:bg-hover hover:text-fg"
                  aria-label={`Bezug ${refLabel(r)} entfernen`}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            {images.map((img, i) => (
              <span key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- Vorschau eines Bildes aus dem Speicher des Browsers */}
                <img src={`data:${img.mediaType};base64,${img.data}`} alt={`Bild ${i + 1}`} className="h-12 rounded-md border border-border object-cover" />
                <button
                  type="button"
                  onClick={() => setImages((list) => list.filter((_, j) => j !== i))}
                  className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-elevated text-muted hover:text-fg"
                  aria-label={`Bild ${i + 1} entfernen`}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'))
            if (files.length) {
              e.preventDefault()
              void addImages(files)
            }
          }}
          maxLength={MAX_AI_CHAT_TEXT}
          rows={2}
          placeholder="Frag Claude … (Enter sendet, Umschalt+Enter für eine neue Zeile)"
          aria-label="Nachricht an Claude"
          data-autofocus
          className="block max-h-40 min-h-11 w-full resize-y rounded-lg border border-border-strong/70 bg-elevated px-3 py-2 text-[15px] outline-none placeholder:text-faint focus:border-accent focus:ring-3 focus:ring-accent/20"
        />
        <ErrorText>{error}</ErrorText>
        <div className="flex items-center gap-1">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => void addImages(Array.from(e.target.files ?? []))}
            data-testid="ai-chat-image-input"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => fileInput.current?.click()}
            disabled={adding || images.length >= MAX_AI_CHAT_IMAGES}
            aria-label="Bild anhängen"
            title="Bild anhängen (oder einfügen)"
          >
            {adding ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setWeb(web === '1' ? '0' : '1')}
            aria-pressed={web === '1'}
            aria-label="Websuche"
            title={web === '1' ? 'Websuche an – Claude sucht bei Bedarf im Netz (etwa 1 Cent je Suche)' : 'Websuche aus'}
            className={cn(web === '1' && 'text-accent-text')}
          >
            <Globe className="size-4" />
          </Button>
          <span className="min-w-0 flex-1 truncate px-1 text-xs text-faint" title="Inhalte gehen nur an Anthropic, wenn Claude sie liest">
            {modelLabel(settings.model)} · nicht gespeichert
          </span>
          {running ? (
            <Button size="sm" onClick={() => chatStore.stop()}>
              <Square className="size-4" /> Stopp
            </Button>
          ) : (
            <Button
              type="submit"
              size="sm"
              variant="primary"
              disabled={!text.trim() && !images.length}
              aria-label="Senden"
              data-testid="ai-chat-send"
            >
              <Send className="size-4" />
            </Button>
          )}
        </div>
      </form>
    </div>
  )
}

function Turn({ turn, retry }: { turn: ChatTurn; retry: () => void }) {
  const { question } = turn
  const answer = turn.parts
    .filter((p): p is Extract<ChatPart, { kind: 'text' }> => p.kind === 'text')
    .map((p) => p.text)
    .join('\n\n')
    .trim()
  return (
    <div className="space-y-2" data-testid="ai-chat-turn">
      <div className="ml-auto w-fit max-w-[85%] space-y-1.5 rounded-2xl rounded-br-md bg-accent-soft px-3 py-2">
        {question.images.length ? (
          <div className="flex flex-wrap gap-1">
            {question.images.map((img, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- Bild aus der Frage, nur im Speicher des Browsers
              <img key={i} src={`data:${img.mediaType};base64,${img.data}`} alt={`Bild ${i + 1}`} className="h-16 rounded-md object-cover" />
            ))}
          </div>
        ) : null}
        {question.text ? <p className="text-[15px] break-words whitespace-pre-wrap">{question.text}</p> : null}
        {question.refs.length ? <p className="text-xs text-muted">Bezug: {question.refs.map(refLabel).join(' · ')}</p> : null}
      </div>
      <div className="space-y-2" data-testid="ai-chat-answer">
        {turn.parts.map((part, i) => (
          <Part key={i} part={part} turnId={turn.id} />
        ))}
        {turn.status === 'running' && !turn.parts.some((p) => p.kind === 'text' || (p.kind === 'tool' && !p.done)) ? (
          <p className="flex items-center gap-1.5 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" /> Claude denkt nach …
          </p>
        ) : null}
        {turn.truncated ? <p className="text-xs text-warning">Die Antwort ist an der Längengrenze abgeschnitten.</p> : null}
        {turn.status === 'error' || turn.status === 'stopped' ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <p className={cn('flex-1', turn.status === 'error' ? 'text-danger' : 'text-muted')}>
              {turn.status === 'error' ? turn.error : 'Abgebrochen.'} Claude kennt diese Frage nicht.
            </p>
            <Button size="sm" onClick={retry}>
              <RotateCcw className="size-4" /> Noch einmal
            </Button>
          </div>
        ) : null}
        {turn.status === 'done' && answer ? <AnswerActions answer={answer} question={question.text} /> : null}
      </div>
    </div>
  )
}

function Part({ part, turnId }: { part: ChatPart; turnId: string }) {
  if (part.kind === 'text') return <CardMarkdown text={part.text} className="text-[15px]" />
  if (part.kind === 'notice') return <p className="text-xs text-warning">{part.text}</p>
  if (part.kind === 'proposal') return <ChatProposal turnId={turnId} partId={part.id} proposal={part.proposal} applied={part.applied} />
  return (
    <p className={cn('flex items-center gap-1.5 text-xs', part.error ? 'text-danger' : 'text-muted')} data-testid="ai-chat-tool">
      {!part.done ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin" />
      ) : part.error ? (
        <AlertCircle className="size-3.5 shrink-0" />
      ) : (
        <Check className="size-3.5 shrink-0" />
      )}
      <span className="min-w-0 break-words">
        {part.label}
        {part.error ? ` – ${part.error}` : ''}
      </span>
    </p>
  )
}

/** Antwort weiterverwenden: kopieren, als Notiz speichern oder Karteikarten daraus machen */
function AnswerActions({ answer, question }: { answer: string; question: string }) {
  const app = useApp()
  const toast = useToast()
  const [cards, setCards] = useState(false)
  const title = sanitizeName(`KI-Chat – ${question.replace(/\s+/g, ' ').trim().slice(0, 60) || 'Antwort'}`)
  return (
    <div className="flex flex-wrap gap-1">
      <Button
        size="sm"
        variant="ghost"
        onClick={async () => {
          if (await copyText(answer)) toast.success('Kopiert.')
        }}
      >
        <ClipboardCopy className="size-4" /> Kopieren
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          void app
            .createNote({ title, folderId: null, content: `${answer}\n`, format: 'markdown' })
            .catch((err) => toast.error(errorMessage(err)))
        }
      >
        <FilePlus className="size-4" /> Als Notiz
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setCards(true)}>
        <Layers className="size-4" /> Karteikarten …
      </Button>
      {cards ? (
        <AiCardsDialog
          subject={title}
          source={async () => ({ kind: 'text', title, content: answer })}
          autoStart
          deckName="Aus dem KI-Chat"
          noteId={null}
          onClose={() => setCards(false)}
        />
      ) : null}
    </div>
  )
}
