/** Geteilte Notizen: ohne App-Rahmen, ohne Anmeldung */
export default function SharedLayout({ children }: LayoutProps<'/s'>) {
  return <div className="min-h-dvh bg-bg text-fg">{children}</div>
}
