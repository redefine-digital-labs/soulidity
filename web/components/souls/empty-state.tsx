import Link from 'next/link'

type EmptyStateProps = {
  icon: React.ReactNode
  heading: string
  description: string
  ctaLabel?: string
  ctaHref?: string
  onCtaClick?: () => void
}

export function EmptyState({ icon, heading, description, ctaLabel, ctaHref, onCtaClick }: EmptyStateProps) {
  return (
    <div className="glass-panel p-12 flex flex-col items-center text-center max-w-md mx-auto gap-4">
      <div style={{ color: 'var(--text-muted)' }}>{icon}</div>
      <h3
        className="text-lg font-semibold"
        style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
      >
        {heading}
      </h3>
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        {description}
      </p>
      {ctaLabel && ctaHref ? (
        <Link href={ctaHref} className="btn btn-primary mt-2">
          {ctaLabel}
        </Link>
      ) : ctaLabel && onCtaClick ? (
        <button type="button" onClick={onCtaClick} className="btn btn-primary mt-2">
          {ctaLabel}
        </button>
      ) : null}
    </div>
  )
}
