import { Logo } from '../Logo'

/** Anmeldung als Karteikarte auf Karopapier: oben der Absender, unter dem roten Strich das Formular */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="paper-grid flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="index-card w-full max-w-md overflow-hidden">
        <div className="flex items-center gap-3 px-6 pt-6 pb-5 sm:px-8">
          <Logo className="size-10" />
          <div className="min-w-0">
            <h1 className="text-xl leading-tight font-bold tracking-tight">Noted</h1>
            <p className="text-sm text-muted">Notizen für die Uni – im Obsidian-Format</p>
          </div>
        </div>
        <div className="index-card-rule" />
        <div className="p-6 sm:p-8">{children}</div>
      </div>
    </main>
  )
}
