import Link from 'next/link'

const YEAR = new Date().getFullYear()

export function SiteFooter() {
  return (
    <footer className="relative z-10 border-t border-border bg-[rgba(13,10,30,0.45)]">
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-3 px-4 py-5 text-[11px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground">Soulidity</span>
          <span className="text-border">·</span>
          <span>© {YEAR}</span>
        </div>
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link className="transition hover:text-foreground" href="/market">Market</Link>
          <Link className="transition hover:text-foreground" href="/community">Community</Link>
          <Link className="transition hover:text-foreground" href="/download">Desktop</Link>
          <span className="text-border">·</span>
          <Link className="transition hover:text-foreground" href="/terms">Terms</Link>
          <Link className="transition hover:text-foreground" href="/privacy">Privacy</Link>
        </nav>
      </div>
    </footer>
  )
}
