/**
 * Aufgaben mit höchstens `max` gleichzeitig ausführen, die übrigen der Reihe nach – z. B. PDFs laden und rendern, damit
 * ein voller Ordner oder ein langes Skript nicht alles auf einmal anstößt.
 */
export function inTurns(max: number) {
  const waiting: (() => void)[] = []
  let running = 0
  return async function inTurn<T>(task: () => Promise<T>): Promise<T> {
    if (running < max) running++
    // Der Platz wird beim Ende einer anderen Aufgabe direkt übergeben
    else await new Promise<void>((resolve) => waiting.push(resolve))
    try {
      return await task()
    } finally {
      const next = waiting.shift()
      if (next) next()
      else running--
    }
  }
}
