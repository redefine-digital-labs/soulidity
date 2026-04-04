'use client'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="min-h-[calc(100vh-56px)] flex flex-col items-center justify-center text-center px-6">
      <div className="text-7xl mb-6 opacity-40">⚠️</div>
      <h1 className="font-display text-2xl font-bold mb-3">Something went wrong</h1>
      <p className="text-muted text-sm max-w-[400px] mb-8">
        {error.message || 'An unexpected error occurred. Please try again.'}
      </p>
      <button
        onClick={reset}
        className="bg-purple text-white font-bold text-sm px-6 py-2.5 rounded-lg hover:bg-purple-deep transition"
      >
        Try Again
      </button>
    </div>
  )
}
