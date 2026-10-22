'use client'
// Druckansicht eines Stapels: die Karten als nummerierte Liste – mit Antworten zum Nachlesen, ohne als Fragebogen
import { PrintOption, PrintView } from '@/shared/ui/print-view'
import { usePref } from '@/shared/client/prefs'
import { CardMarkdown } from './CardMarkdown'
import { OcclusionImage } from './Occlusion'
import { clozeBlanks } from '../cloze'
import { maskName } from '../occlusion'
import type { Card, Deck } from '../types'

function PrintCard({ card, answers }: { card: Card; answers: boolean }) {
  if (card.type === 'cloze') {
    return (
      <>
        {/* Mit Antworten bleiben die Lücken als ==Markierung== hervorgehoben */}
        <CardMarkdown text={answers ? card.front : clozeBlanks(card.front)} />
        {answers && card.back.trim() ? <CardMarkdown text={card.back} className="print-answer" /> : null}
      </>
    )
  }
  if (card.type === 'mc') {
    return (
      <>
        <CardMarkdown text={card.front} />
        <ul className="print-options">
          {card.options.map((o, i) => (
            <li key={i}>
              <CardMarkdown text={answers && o.correct ? `✓ ${o.text}` : o.text} />
            </li>
          ))}
        </ul>
        {answers && card.back.trim() ? <CardMarkdown text={card.back} className="print-answer" /> : null}
      </>
    )
  }
  if (card.type === 'occlusion' && card.occlusion) {
    const occlusion = card.occlusion
    return (
      <>
        {card.front.trim() ? <CardMarkdown text={card.front} /> : null}
        {/* Alle Flächen verdeckt */}
        <OcclusionImage occlusion={{ ...occlusion, hideAll: true }} side={-1} revealed={false} alt={card.front} />
        {answers ? (
          <ol className="print-answer print-masks">
            {occlusion.masks.map((_, i) => (
              <li key={i}>{maskName(occlusion, i)}</li>
            ))}
          </ol>
        ) : null}
      </>
    )
  }
  return (
    <>
      <CardMarkdown text={card.front} />
      {answers ? <CardMarkdown text={card.back} className="print-answer" /> : null}
    </>
  )
}

/** `cards`: in der angezeigten Reihenfolge, mit Suche und Filter */
export function DeckPrint({ deck, cards, onClose }: { deck: Deck; cards: Card[]; onClose: () => void }) {
  const [answers, setAnswers] = usePref<'1' | '0'>('noted:print:answers', '1')
  const [compact, setCompact] = usePref<'1' | '0'>('noted:print:compact', '0')
  return (
    <PrintView
      title={deck.name}
      heading={deck.name}
      compact={compact === '1'}
      onClose={onClose}
      options={
        <>
          <PrintOption label="Antworten" checked={answers === '1'} onChange={(v) => setAnswers(v ? '1' : '0')} />
          <PrintOption label="Kompakt" checked={compact === '1'} onChange={(v) => setCompact(v ? '1' : '0')} />
        </>
      }
    >
      <p className="print-meta">
        {deck.description ? `${deck.description} · ` : ''}
        {cards.length} {cards.length === 1 ? 'Karte' : 'Karten'}
      </p>
      <ol className="print-cards">
        {cards.map((card) => (
          <li key={card.id} className="print-card">
            <PrintCard card={card} answers={answers === '1'} />
          </li>
        ))}
      </ol>
    </PrintView>
  )
}
