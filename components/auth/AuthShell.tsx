import { Logo } from '../Logo'

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-subtle px-4 py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[48rem] -translate-x-1/2 rounded-full bg-accent/20 blur-3xl"
      />
      <div className="relative w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Logo className="size-14 drop-shadow-lg" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Noted</h1>
            <p className="text-sm text-muted">Notizen für die Uni – im Obsidian-Format</p>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-elevated p-6 shadow-card sm:p-8">{children}</div>
      </div>
    </main>
  )
}
