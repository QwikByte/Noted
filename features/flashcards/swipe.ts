// Bewerten per Wischgeste (Handy): nur waagerecht, weit genug und deutlich waagerechter als senkrecht – senkrecht bleibt
// Scrollen. Reine Logik, ohne Browser.

export type SwipeDirection = 'left' | 'right'

/** Anteil der Kartenbreite, ab dem ein Wisch zählt – eher hoch, damit Scrollen nichts auslöst */
const SWIPE_SHARE = 0.3
/** Mindestens so weit (px), auch auf schmalen Karten */
const MIN_SWIPE = 60

/** Richtung eines Wischs um `dx`/`dy` auf einer Karte der Breite `width` – null, wenn er nichts auslöst */
export function swipeDecision(dx: number, dy: number, width: number): SwipeDirection | null {
  if (Math.abs(dx) < Math.max(MIN_SWIPE, width * SWIPE_SHARE)) return null
  if (Math.abs(dx) < 2 * Math.abs(dy)) return null
  return dx < 0 ? 'left' : 'right'
}

/** Wird gerade waagerecht gewischt? Dann folgt die Karte dem Finger. */
export const isHorizontal = (dx: number, dy: number) => Math.abs(dx) > 2 * Math.abs(dy)
