// Eingabeprüfung der KI-Routen (zod) – Größen nach limits.ts, damit eine Anfrage weder den Server noch das Konto
// bei Anthropic unnötig belastet.
import { z } from 'zod'
import { MAX_CARD_TEXT, MAX_OPTION_TEXT, MAX_OPTIONS } from '@/features/flashcards/limits'
import {
  MAX_AI_ANSWER_CHARS,
  MAX_AI_EXAM_DECKS,
  MAX_AI_EXISTING,
  MAX_AI_GRADE_ITEMS,
  MAX_AI_IMAGE_CHARS,
  MAX_AI_IMAGES,
  MAX_AI_MARKS,
  MAX_AI_NOTE_CHARS,
  MAX_AI_PAGE_TEXT,
  MAX_AI_PDF_PAGES,
  MAX_AI_QUESTIONS,
  MAX_AI_TASK_PHOTOS,
  MAX_AI_WISHES,
} from './limits'

const TOO_LONG = `Der Text ist für Claude zu lang (höchstens ${MAX_AI_NOTE_CHARS.toLocaleString('de-DE')} Zeichen).`

const image = z.object({
  mediaType: z.enum(['image/jpeg', 'image/png']),
  data: z
    .string()
    .min(1)
    .max(MAX_AI_IMAGE_CHARS, 'Ein Bild ist zu groß.')
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Ungültiges Bild.'),
})

const page = z.number().int().min(1).max(100_000)
const text = (max: number) => z.string().max(max, TOO_LONG)

const cardDraft = z.object({
  type: z.enum(['basic', 'reversed', 'cloze', 'mc']),
  front: z.string().max(MAX_CARD_TEXT),
  back: z.string().max(MAX_CARD_TEXT),
  options: z.array(z.object({ text: z.string().max(MAX_OPTION_TEXT), correct: z.boolean() })).max(MAX_OPTIONS),
})

const source = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('note'), noteId: z.string().min(1).max(100), title: z.string().max(1000), content: text(MAX_AI_NOTE_CHARS) }),
  z.object({
    kind: z.literal('pdf'),
    file: z.string().min(1).max(1000),
    pages: z
      .array(z.object({ page, text: text(MAX_AI_PAGE_TEXT), image: image.optional() }))
      .max(MAX_AI_PDF_PAGES, `Höchstens ${MAX_AI_PDF_PAGES} Seiten auf einmal.`),
    marks: z
      .array(z.object({ page, quote: text(MAX_CARD_TEXT), comment: text(MAX_CARD_TEXT), image: image.optional() }))
      .max(MAX_AI_MARKS, `Höchstens ${MAX_AI_MARKS} Markierungen auf einmal.`),
  }),
  z.object({ kind: z.literal('card'), mode: z.enum(['improve', 'split', 'leech']), card: cardDraft }),
])

const imageCount = (n: number) => n <= MAX_AI_IMAGES
const TOO_MANY_IMAGES = `Höchstens ${MAX_AI_IMAGES} Seiten oder Bereiche als Bild auf einmal.`

export const cardsRequestSchema = z
  .object({
    source,
    existing: z.array(z.string().max(MAX_CARD_TEXT)).max(MAX_AI_EXISTING).optional(),
    wishes: z.string().max(MAX_AI_WISHES, 'Die Wünsche sind zu lang.').optional(),
  })
  .refine(
    ({ source: s }) => s.kind !== 'pdf' || imageCount([...s.pages, ...s.marks].filter((p) => p.image).length),
    TOO_MANY_IMAGES,
  )

export const assistRequestSchema = z.object({
  task: z.enum(['edit', 'answer']),
  instruction: z.string().max(MAX_AI_WISHES, 'Der Auftrag ist zu lang.'),
  title: z.string().max(1000),
  text: text(MAX_AI_NOTE_CHARS),
  context: text(MAX_AI_NOTE_CHARS).optional(),
  plain: z.boolean().optional(),
  images: z.array(image).refine((list) => imageCount(list.length), TOO_MANY_IMAGES).optional(),
  noteId: z.string().min(1).max(100).optional(),
})

export const metaRequestSchema = z.object({
  noteId: z.string().min(1).max(100),
  title: z.string().max(1000),
  content: text(MAX_AI_NOTE_CHARS),
})

const answerText = z.string().max(MAX_AI_ANSWER_CHARS, 'Eine Antwort ist zu lang.')

const gradeItem = z.object({
  question: answerText,
  expected: answerText,
  answer: answerText,
  images: z.array(image).max(MAX_AI_TASK_PHOTOS, `Höchstens ${MAX_AI_TASK_PHOTOS} Fotos je Aufgabe.`).optional(),
  points: z.number().int().min(1).max(100).optional(),
})

const itemChars = (i: z.infer<typeof gradeItem>) => i.question.length + i.expected.length + i.answer.length

export const gradeRequestSchema = z
  .object({
    items: z.array(gradeItem).min(1).max(MAX_AI_GRADE_ITEMS, `Höchstens ${MAX_AI_GRADE_ITEMS} Aufgaben auf einmal.`),
    title: z.string().max(1000),
    context: text(MAX_AI_NOTE_CHARS).optional(),
    noteId: z.string().min(1).max(100).optional(),
  })
  .refine(({ items }) => imageCount(items.reduce((n, i) => n + (i.images?.length ?? 0), 0)), `Höchstens ${MAX_AI_IMAGES} Fotos auf einmal.`)
  .refine(({ items, context }) => items.reduce((n, i) => n + itemChars(i), context?.length ?? 0) <= MAX_AI_NOTE_CHARS, TOO_LONG)

export const questionsRequestSchema = z.object({
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('note'), noteId: z.string().min(1).max(100), title: z.string().max(1000), content: text(MAX_AI_NOTE_CHARS) }),
    z.object({
      kind: z.literal('decks'),
      title: z.string().max(1000),
      deckIds: z.array(z.string().min(1).max(100)).min(1).max(MAX_AI_EXAM_DECKS),
    }),
  ]),
  count: z.number().int().min(1).max(MAX_AI_QUESTIONS),
  wishes: z.string().max(MAX_AI_WISHES, 'Die Wünsche sind zu lang.').optional(),
})

/** Größte Anfrage in Bytes: alle Bilder plus Text */
export const MAX_AI_REQUEST_BYTES = MAX_AI_IMAGES * MAX_AI_IMAGE_CHARS + 4 * MAX_AI_NOTE_CHARS * 2
