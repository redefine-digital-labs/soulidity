import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-[calc(100vh-56px)] flex flex-col items-center justify-center text-center px-6">
      <div className="text-7xl mb-6 opacity-40">👻</div>
      <h1 className="font-display text-3xl font-bold mb-3">404 — Soul Not Found</h1>
      <p className="text-muted text-sm max-w-[400px] mb-8">
        This page doesn&apos;t exist on-chain. It may have been moved, or the Soul
        may have transferred to a new owner.
      </p>
      <div className="flex gap-3">
        <Link
          href="/market"
          className="bg-purple text-white font-bold text-sm px-6 py-2.5 rounded-lg hover:bg-purple-deep transition"
        >
          Browse Market
        </Link>
        <Link
          href="/"
          className="bg-transparent text-foreground border border-border font-semibold text-sm px-6 py-2.5 rounded-lg hover:border-purple transition"
        >
          Go Home
        </Link>
      </div>
    </div>
  )
}
