'use client'

type SoulDetailErrorProps = {
  error: Error & { digest?: string }
  reset: () => void
}

export default function SoulDetailError({ error: _error, reset }: SoulDetailErrorProps) {
  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <div className="glass-card p-6 text-center space-y-3">
        <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
          Unable to load this soul
        </h2>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          The detail page hit an unexpected error. Try reloading the page.
        </p>
        <div>
          <button type="button" className="btn btn-secondary" onClick={() => reset()}>
            Retry
          </button>
        </div>
      </div>
    </div>
  )
}
